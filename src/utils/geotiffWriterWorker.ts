import type { GeoTransform } from './geotiff';
// GeoTIFF作成関数
const createGeoTiffBufferWorker = (demArray: number[][], geoTransform: GeoTransform): ArrayBuffer => {
    const height = demArray.length;
    const width = demArray[0].length;
    const bytesPerPixel = 4;
    const imageDataSize = width * height * bytesPerPixel;

    // GeoTIFF用の追加データ
    const modelPixelScale = new Float64Array([
        Math.abs(geoTransform.pixelSizeX), // X pixel size
        Math.abs(geoTransform.pixelSizeY), // Y pixel size
        0.0, // Z pixel size
    ]);

    const modelTiepoint = new Float64Array([
        0.0, // Raster X
        0.0, // Raster Y
        0.0, // Raster Z
        geoTransform.upperLeftX, // Model X (longitude)
        geoTransform.upperLeftY, // Model Y (latitude)
        0.0, // Model Z
    ]);

    // GeoKeyDirectoryの正しい構造
    const geoKeyDirectory = new Uint16Array([
        1, // KeyDirectoryVersion
        1, // KeyRevision
        0, // MinorRevision
        3, // NumberOfKeys

        // GTModelTypeGeoKey = 2 (Geographic)
        1024,
        0,
        1,
        2,

        // GTRasterTypeGeoKey = 1 (RasterPixelIsArea)
        1025,
        0,
        1,
        1,

        // GeographicTypeGeoKey = 4326 (WGS84)
        2048,
        0,
        1,
        4326,
    ]);

    // オフセット計算
    const tiffHeaderSize = 8;
    const ifdEntryCount = 18; // 17から18に変更（NODATA用）
    const ifdSize = 2 + ifdEntryCount * 12 + 4;

    const geoKeyDirectoryOffset = tiffHeaderSize + ifdSize;
    // NODATA値を文字列として格納するためのオフセット
    const nodataString = '-9999';
    const nodataStringOffset = geoKeyDirectoryOffset + geoKeyDirectory.length * 2;
    const modelPixelScaleOffset = nodataStringOffset + nodataString.length + 1; // null終端を含む
    const modelTiepointOffset = modelPixelScaleOffset + 3 * 8;
    const imageDataOffset = modelTiepointOffset + 6 * 8;

    const totalSize = imageDataOffset + imageDataSize;

    console.log(`Creating GeoTIFF: ${width}x${height}, ${totalSize} bytes`);

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let offset = 0;

    // === TIFFヘッダー ===
    view.setUint16(offset, 0x4949, true); // "II" - Little endian
    offset += 2;
    view.setUint16(offset, 42, true); // TIFF magic number
    offset += 2;
    view.setUint32(offset, 8, true); // Offset to first IFD
    offset += 4;

    // === IFD (Image File Directory) ===
    view.setUint16(offset, ifdEntryCount, true); // Number of directory entries
    offset += 2;

    const writeIFDEntry = (tag: number, type: number, count: number, value: number) => {
        view.setUint16(offset, tag, true); // Tag
        view.setUint16(offset + 2, type, true); // Type
        view.setUint32(offset + 4, count, true); // Count
        view.setUint32(offset + 8, value, true); // Value/Offset
        offset += 12;
    };

    // 基本的なTIFFタグ
    writeIFDEntry(256, 4, 1, width); // ImageWidth
    writeIFDEntry(257, 4, 1, height); // ImageLength
    writeIFDEntry(258, 3, 1, 32); // BitsPerSample
    writeIFDEntry(259, 3, 1, 1); // Compression
    writeIFDEntry(262, 3, 1, 1); // PhotometricInterpretation
    writeIFDEntry(273, 4, 1, imageDataOffset); // StripOffsets
    writeIFDEntry(277, 3, 1, 1); // SamplesPerPixel
    writeIFDEntry(278, 4, 1, height); // RowsPerStrip
    writeIFDEntry(279, 4, 1, imageDataSize); // StripByteCounts
    writeIFDEntry(282, 5, 1, 0); // XResolution
    writeIFDEntry(283, 5, 1, 0); // YResolution
    writeIFDEntry(284, 3, 1, 1); // PlanarConfiguration
    writeIFDEntry(296, 3, 1, 2); // ResolutionUnit
    writeIFDEntry(339, 3, 1, 3); // SampleFormat (IEEE float)

    // GeoTIFFタグ
    writeIFDEntry(33550, 12, 3, modelPixelScaleOffset); // ModelPixelScaleTag
    writeIFDEntry(33922, 12, 6, modelTiepointOffset); // ModelTiepointTag
    writeIFDEntry(34735, 3, geoKeyDirectory.length, geoKeyDirectoryOffset); // GeoKeyDirectoryTag
    writeIFDEntry(42113, 2, nodataString.length + 1, nodataStringOffset); // GDAL_NODATA

    // Next IFD offset (0 = no more IFDs)
    view.setUint32(offset, 0, true);

    // === GeoKeyDirectory ===
    const geoKeyView = new Uint16Array(buffer, geoKeyDirectoryOffset, geoKeyDirectory.length);
    geoKeyView.set(geoKeyDirectory);

    // === NODATA文字列 ===
    const nodataBytes = new TextEncoder().encode(nodataString + '\0'); // null終端
    const nodataView = new Uint8Array(buffer, nodataStringOffset, nodataBytes.length);
    nodataView.set(nodataBytes);

    // === ModelPixelScale ===
    for (let i = 0; i < 3; i++) {
        view.setFloat64(modelPixelScaleOffset + i * 8, modelPixelScale[i], true);
    }

    // === ModelTiepoint ===
    for (let i = 0; i < 6; i++) {
        view.setFloat64(modelTiepointOffset + i * 8, modelTiepoint[i], true);
    }

    // === 画像データ ===
    let dataOffset = imageDataOffset;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            view.setFloat32(dataOffset, demArray[y][x], true);
            dataOffset += 4;
        }
    }

    return buffer;
};

// WebWorkerのメッセージハンドラー
self.onmessage = (e) => {
    const { demArray, geoTransform } = e.data;

    try {
        self.postMessage({ type: 'progress', message: 'GeoTIFF処理開始...', progress: 0 });

        // データ検証
        if (!demArray || !demArray.length || !demArray[0] || !demArray[0].length) {
            throw new Error('Invalid demArray data');
        }

        if (!geoTransform || geoTransform.length !== 6) {
            throw new Error('Invalid geoTransform data (must be array of 6 elements)');
        }

        self.postMessage({
            type: 'info',
            message: `処理データ: ${demArray[0].length} × ${demArray.length} pixels`,
        });

        const buffer = createGeoTiffBufferWorker(demArray, geoTransform);

        self.postMessage({
            type: 'complete',
            buffer: buffer,
            message: 'GeoTIFF作成完了',
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message,
            stack: error.stack,
        });
    }
};

// WebWorkerのメッセージハンドラー
self.onmessage = (e) => {
    const { type, demArray, geoTransform, includeGeoInfo } = e.data;

    try {
        self.postMessage({ type: 'progress', message: '処理開始...', progress: 0 });

        let buffer = createGeoTiffBufferWorker(demArray, geoTransform);

        self.postMessage({
            type: 'complete',
            buffer: buffer,
            message: 'TIFF作成完了',
        });
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error.message,
            stack: error.stack,
        });
    }
};
