import type { GeoTransform } from "./geotiff";

// 標高値をTerrain RGB形式にエンコード

const elevationToTerrainRGB = (elevation: number): [number, number, number, number] => {
    // 無効値の場合は透明に
    if (elevation === -9999 || isNaN(elevation)) {
        return [0, 0, 0, 0]; // 透明
    }

    const value = (elevation + 10000) * 10;

    // 24bit値を制限
    const clampedValue = Math.max(0, Math.min(16777215, Math.round(value)));

    // RGB値に分解（GLSLと同じ計算）
    const r = Math.floor(clampedValue / 65536); // 256*256
    const g = Math.floor((clampedValue % 65536) / 256);
    const b = clampedValue % 256;

    return [r, g, b, 255]; // 不透明
};

// Terrain RGB GeoTIFF作成関数
const createTerrainRGBGeoTiffBuffer = (
    demArray: number[][],
    geoTransform: GeoTransform,
): ArrayBuffer => {
    const height = demArray.length;
    const width = demArray[0].length;
    const samplesPerPixel = 4; // RGBA
    const bitsPerSample = 8; // 8-bit per channel
    const bytesPerPixel = samplesPerPixel; // 4 bytes (RGBA)
    const imageDataSize = width * height * bytesPerPixel;

    console.log(
        `Creating Terrain RGB GeoTIFF: ${width}x${height}, ${samplesPerPixel} channels, ${imageDataSize} bytes`,
    );

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

    // GeoKeyDirectoryの構造
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

    // 文字列データ
    const imageDescription = "Terrain RGB encoded elevation data";
    const nodataString = "0 0 0 0"; // RGBA形式でのNoData値

    // BitsPerSample配列（各チャンネルが8bit）
    const bitsPerSampleArray = new Uint16Array([8, 8, 8, 8]); // RGBA

    // アライメント調整用のヘルパー関数
    const alignTo = (value: number, alignment: number): number => {
        return Math.ceil(value / alignment) * alignment;
    };

    // オフセット計算（アライメント考慮）
    const tiffHeaderSize = 8;
    const ifdEntryCount = 18; // アルファ関連のタグを削除してエントリ数を減らす
    const ifdSize = 2 + ifdEntryCount * 12 + 4;

    let currentOffset = tiffHeaderSize + ifdSize;

    // 文字列データ（1バイトアライメント）
    const imageDescriptionOffset = currentOffset;
    currentOffset += imageDescription.length + 1;

    const nodataStringOffset = currentOffset;
    currentOffset += nodataString.length + 1;

    // Uint16Array用に2バイトアライメント
    currentOffset = alignTo(currentOffset, 2);
    const geoKeyDirectoryOffset = currentOffset;
    currentOffset += geoKeyDirectory.length * 2;

    const bitsPerSampleOffset = currentOffset;
    currentOffset += bitsPerSampleArray.length * 2;

    // Float64Array用に8バイトアライメント
    currentOffset = alignTo(currentOffset, 8);
    const modelPixelScaleOffset = currentOffset;
    currentOffset += 3 * 8;

    const modelTiepointOffset = currentOffset;
    currentOffset += 6 * 8;

    // 画像データ用に4バイトアライメント
    currentOffset = alignTo(currentOffset, 4);
    const imageDataOffset = currentOffset;
    const totalSize = imageDataOffset + imageDataSize;

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

    // 基本的なTIFFタグ（アルファ関連のタグを修正）
    writeIFDEntry(256, 4, 1, width); // ImageWidth
    writeIFDEntry(257, 4, 1, height); // ImageLength
    writeIFDEntry(258, 3, 4, bitsPerSampleOffset); // BitsPerSample (8,8,8,8)
    writeIFDEntry(259, 3, 1, 1); // Compression (none)
    writeIFDEntry(262, 3, 1, 2); // PhotometricInterpretation (RGB)
    writeIFDEntry(270, 2, imageDescription.length + 1, imageDescriptionOffset); // ImageDescription
    writeIFDEntry(273, 4, 1, imageDataOffset); // StripOffsets
    writeIFDEntry(277, 3, 1, samplesPerPixel); // SamplesPerPixel (4 for RGBA)
    writeIFDEntry(278, 4, 1, height); // RowsPerStrip
    writeIFDEntry(279, 4, 1, imageDataSize); // StripByteCounts
    writeIFDEntry(282, 5, 1, 0); // XResolution
    writeIFDEntry(283, 5, 1, 0); // YResolution
    writeIFDEntry(284, 3, 1, 1); // PlanarConfiguration (chunky)
    writeIFDEntry(296, 3, 1, 2); // ResolutionUnit
    // ExtraSamplesタグを削除または変更
    // writeIFDEntry(338, 3, 1, 1); // ExtraSamples (1 = associated alpha) - 削除

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

    // === ImageDescription ===
    const imageDescBytes = new TextEncoder().encode(imageDescription + "\0");
    const imageDescView = new Uint8Array(buffer, imageDescriptionOffset, imageDescBytes.length);
    imageDescView.set(imageDescBytes);

    // === NODATA文字列 ===
    const nodataBytes = new TextEncoder().encode(nodataString + "\0");
    const nodataView = new Uint8Array(buffer, nodataStringOffset, nodataBytes.length);
    nodataView.set(nodataBytes);

    // === BitsPerSample配列 ===
    const bitsPerSampleView = new Uint16Array(
        buffer,
        bitsPerSampleOffset,
        bitsPerSampleArray.length,
    );
    bitsPerSampleView.set(bitsPerSampleArray);

    // === ModelPixelScale ===
    for (let i = 0; i < 3; i++) {
        view.setFloat64(modelPixelScaleOffset + i * 8, modelPixelScale[i], true);
    }

    // === ModelTiepoint ===
    for (let i = 0; i < 6; i++) {
        view.setFloat64(modelTiepointOffset + i * 8, modelTiepoint[i], true);
    }

    // === Terrain RGB画像データ ===
    let dataOffset = imageDataOffset;
    let validPixels = 0;
    let transparentPixels = 0;
    let totalPixels = width * height;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const elevation = demArray[y][x];
            const [r, g, b, a] = elevationToTerrainRGB(elevation);

            // RGBAを書き込み
            view.setUint8(dataOffset, r);
            view.setUint8(dataOffset + 1, g);
            view.setUint8(dataOffset + 2, b);
            view.setUint8(dataOffset + 3, a);

            if (a === 0) {
                transparentPixels++;
            } else {
                validPixels++;
            }

            dataOffset += 4;
        }

        // 進捗報告（100行ごと）
        if (y % 100 === 0) {
            const progress = (y / height) * 0.8 + 0.1; // 10%から90%
            self.postMessage({
                type: "progress",
                message: `Terrain RGB変換中: ${((y / height) * 100).toFixed(1)}%`,
                progress: progress,
            });
        }
    }

    console.log(`=== Terrain RGB変換完了 ===`);
    console.log(`- 全ピクセル数: ${totalPixels}`);
    console.log(`- 有効ピクセル: ${validPixels}`);
    console.log(`- 透明ピクセル: ${transparentPixels}`);
    console.log(`- 有効率: ${((validPixels / totalPixels) * 100).toFixed(1)}%`);

    return buffer;
};

// RGB-only版（3バンド、アルファなし）
const createTerrainRGBGeoTiffBuffer_RGB = (
    demArray: number[][],
    geoTransform: GeoTransform,
): ArrayBuffer => {
    const height = demArray.length;
    const width = demArray[0].length;
    const samplesPerPixel = 3; // RGBのみ
    const bitsPerSample = 8;
    const bytesPerPixel = samplesPerPixel;
    const imageDataSize = width * height * bytesPerPixel;

    console.log(
        `Creating Terrain RGB GeoTIFF (RGB-only): ${width}x${height}, ${imageDataSize} bytes`,
    );

    const modelPixelScale = new Float64Array([
        Math.abs(geoTransform.pixelSizeX),
        Math.abs(geoTransform.pixelSizeY),
        0.0,
    ]);

    const modelTiepoint = new Float64Array([
        0.0,
        0.0,
        0.0,
        geoTransform.upperLeftX,
        geoTransform.upperLeftY,
        0.0,
    ]);

    const geoKeyDirectory = new Uint16Array([
        1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326,
    ]);

    const imageDescription = "Terrain RGB encoded elevation data (RGB-only)";
    const nodataString = "0 0 0";
    const bitsPerSampleArray = new Uint16Array([8, 8, 8]);

    const alignTo = (value: number, alignment: number): number => {
        return Math.ceil(value / alignment) * alignment;
    };

    const tiffHeaderSize = 8;
    const ifdEntryCount = 17; // RGB用のエントリ数（ExtraSamples不要）
    const ifdSize = 2 + ifdEntryCount * 12 + 4;

    let currentOffset = tiffHeaderSize + ifdSize;

    const imageDescriptionOffset = currentOffset;
    currentOffset += imageDescription.length + 1;

    const nodataStringOffset = currentOffset;
    currentOffset += nodataString.length + 1;

    currentOffset = alignTo(currentOffset, 2);
    const geoKeyDirectoryOffset = currentOffset;
    currentOffset += geoKeyDirectory.length * 2;

    const bitsPerSampleOffset = currentOffset;
    currentOffset += bitsPerSampleArray.length * 2;

    currentOffset = alignTo(currentOffset, 8);
    const modelPixelScaleOffset = currentOffset;
    currentOffset += 3 * 8;

    const modelTiepointOffset = currentOffset;
    currentOffset += 6 * 8;

    currentOffset = alignTo(currentOffset, 4);
    const imageDataOffset = currentOffset;
    const totalSize = imageDataOffset + imageDataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    let offset = 0;

    // TIFFヘッダー
    view.setUint16(offset, 0x4949, true);
    offset += 2;
    view.setUint16(offset, 42, true);
    offset += 2;
    view.setUint32(offset, 8, true);
    offset += 4;

    // IFD
    view.setUint16(offset, ifdEntryCount, true);
    offset += 2;

    const writeIFDEntry = (tag: number, type: number, count: number, value: number) => {
        view.setUint16(offset, tag, true);
        view.setUint16(offset + 2, type, true);
        view.setUint32(offset + 4, count, true);
        view.setUint32(offset + 8, value, true);
        offset += 12;
    };

    // 基本的なTIFFタグ（RGB専用）
    writeIFDEntry(256, 4, 1, width); // ImageWidth
    writeIFDEntry(257, 4, 1, height); // ImageLength
    writeIFDEntry(258, 3, 3, bitsPerSampleOffset); // BitsPerSample (8,8,8)
    writeIFDEntry(259, 3, 1, 1); // Compression (none)
    writeIFDEntry(262, 3, 1, 2); // PhotometricInterpretation (RGB)
    writeIFDEntry(270, 2, imageDescription.length + 1, imageDescriptionOffset); // ImageDescription
    writeIFDEntry(273, 4, 1, imageDataOffset); // StripOffsets
    writeIFDEntry(277, 3, 1, samplesPerPixel); // SamplesPerPixel (3 for RGB)
    writeIFDEntry(278, 4, 1, height); // RowsPerStrip
    writeIFDEntry(279, 4, 1, imageDataSize); // StripByteCounts
    writeIFDEntry(282, 5, 1, 0); // XResolution
    writeIFDEntry(283, 5, 1, 0); // YResolution
    writeIFDEntry(284, 3, 1, 1); // PlanarConfiguration (chunky)
    writeIFDEntry(296, 3, 1, 2); // ResolutionUnit

    // GeoTIFFタグ
    writeIFDEntry(33550, 12, 3, modelPixelScaleOffset); // ModelPixelScaleTag
    writeIFDEntry(33922, 12, 6, modelTiepointOffset); // ModelTiepointTag
    writeIFDEntry(34735, 3, geoKeyDirectory.length, geoKeyDirectoryOffset); // GeoKeyDirectoryTag
    writeIFDEntry(42113, 2, nodataString.length + 1, nodataStringOffset); // GDAL_NODATA

    view.setUint32(offset, 0, true);

    // データ書き込み
    const geoKeyView = new Uint16Array(buffer, geoKeyDirectoryOffset, geoKeyDirectory.length);
    geoKeyView.set(geoKeyDirectory);

    const imageDescBytes = new TextEncoder().encode(imageDescription + "\0");
    const imageDescView = new Uint8Array(buffer, imageDescriptionOffset, imageDescBytes.length);
    imageDescView.set(imageDescBytes);

    const nodataBytes = new TextEncoder().encode(nodataString + "\0");
    const nodataView = new Uint8Array(buffer, nodataStringOffset, nodataBytes.length);
    nodataView.set(nodataBytes);

    const bitsPerSampleView = new Uint16Array(
        buffer,
        bitsPerSampleOffset,
        bitsPerSampleArray.length,
    );
    bitsPerSampleView.set(bitsPerSampleArray);

    for (let i = 0; i < 3; i++) {
        view.setFloat64(modelPixelScaleOffset + i * 8, modelPixelScale[i], true);
    }

    for (let i = 0; i < 6; i++) {
        view.setFloat64(modelTiepointOffset + i * 8, modelTiepoint[i], true);
    }

    // RGB画像データ（無効値は黒で表現）
    let dataOffset = imageDataOffset;
    let validPixels = 0;
    let invalidPixels = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const elevation = demArray[y][x];

            if (elevation === -9999 || isNaN(elevation) || !isFinite(elevation)) {
                // 無効値は黒（0,0,0）
                view.setUint8(dataOffset, 0);
                view.setUint8(dataOffset + 1, 0);
                view.setUint8(dataOffset + 2, 0);
                invalidPixels++;
            } else {
                const [r, g, b] = elevationToTerrainRGB(elevation);
                view.setUint8(dataOffset, r);
                view.setUint8(dataOffset + 1, g);
                view.setUint8(dataOffset + 2, b);
                validPixels++;
            }

            dataOffset += 3;
        }

        if (y % 100 === 0) {
            const progress = (y / height) * 0.8 + 0.1;
            self.postMessage({
                type: "progress",
                message: `Terrain RGB変換中 (RGB): ${((y / height) * 100).toFixed(1)}%`,
                progress: progress,
            });
        }
    }

    console.log(`RGB版 変換完了: 有効=${validPixels}, 無効=${invalidPixels}`);
    return buffer;
};

// WebWorkerのメッセージハンドラー
self.onmessage = (e) => {
    const { demArray, geoTransform, testEncoding = false } = e.data;

    try {
        self.postMessage({
            type: "progress",
            message: "Terrain RGB GeoTIFF処理開始...",
            progress: 0,
        });

        // データ検証
        if (!demArray || !demArray.length || !demArray[0] || !demArray[0].length) {
            throw new Error("Invalid demArray data");
        }

        if (!geoTransform) {
            throw new Error("Invalid geoTransform data");
        }

        const width = demArray[0].length;
        const height = demArray.length;

        self.postMessage({
            type: "info",
            message: `処理データ: ${width} × ${height} pixels (Terrain RGB形式)`,
        });

        self.postMessage({
            type: "progress",
            message: "Terrain RGB GeoTIFF作成中...",
            progress: 0.1,
        });

        const buffer = createTerrainRGBGeoTiffBuffer_RGB(demArray, geoTransform);

        self.postMessage({
            type: "progress",
            message: "Terrain RGB GeoTIFF作成完了",
            progress: 1.0,
        });

        self.postMessage({
            type: "complete",
            buffer: buffer,
            message: "Terrain RGB GeoTIFF作成完了",
            width: width,
            height: height,
            size: buffer.byteLength,
            format: "TerrainRGB",
        });
    } catch (error) {
        if (error instanceof Error) {
            self.postMessage({
                type: "error",
                error: error.message,
                stack: error.stack,
            });
        } else {
            self.postMessage({
                type: "error",
                error: "Unknown error occurred",
                stack: "",
            });
        }
    }
};
