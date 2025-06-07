import type { Dem, MetaData } from './demxml';

// 地理的境界の型定義
export interface GeographicBounds {
    lower_left: {
        lat: number;
        lon: number;
    };
    upper_right: {
        lat: number;
        lon: number;
    };
}

// 画像サイズの型定義
export interface ImageSize {
    x: number;
    y: number;
}

// GeoTransformの型定義
export interface GeoTransform {
    upperLeftX: number; // 左上X座標
    pixelSizeX: number; // X方向ピクセルサイズ
    rotationX: number; // X軸回転（通常0）
    upperLeftY: number; // 左上Y座標
    rotationY: number; // Y軸回転（通常0）
    pixelSizeY: number; // Y方向ピクセルサイズ（負値）
}

// 統計情報の型定義
export interface Statistics {
    validPixels: number;
    invalidPixels: number;
    minElevation: number;
    maxElevation: number;
    averageElevation: number;
    bounds: GeographicBounds;
    imageSize: ImageSize;
}

// ファイル情報の型定義
export interface FileInfo {
    filename: string;
    content: string;
}

// GeoTIFFデータの型定義
export interface GeoTiffData {
    geoTransform: GeoTransform;
    demArray: number[][];
    imageSize: ImageSize;
    statistics: Statistics;
}

// 標高配列データの型定義
export interface ElevationData {
    elevations: number[];
    width: number;
    height: number;
    statistics: Statistics;
    timestamp: string;
}

interface MeshData extends MetaData {
    np_array: number[][];
}

// カスタムエラークラス
export class GeoTiffException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GeoTiffException';
    }
}

export class GeoTiffGenerator {
    private dem: Dem;
    private onProgress?: (current: number, total: number, message: string) => void;

    constructor(dem: Dem, onProgress?: (current: number, total: number, message: string) => void) {
        this.dem = dem;
        this.onProgress = onProgress;
    }

    // 画像サイズの計算（Python版の_calc_image_sizeと同等）
    private calcImageSize(): ImageSize {
        const bounds = this.dem.boundsLatLng;
        const metaDataList = this.dem.getMetaDataList();

        if (metaDataList.length === 0) {
            throw new GeoTiffException('No metadata available');
        }

        // 最初のメッシュのピクセルサイズを使用（全メッシュで同じはず）
        const pixelSize = metaDataList[0].pixel_size;

        const xLength = Math.round(Math.abs((bounds.upper_right.lon - bounds.lower_left.lon) / pixelSize.x));

        const yLength = Math.round(Math.abs((bounds.upper_right.lat - bounds.lower_left.lat) / Math.abs(pixelSize.y)));

        // サイズ制限チェック（4GB制限）
        if (xLength >= 32000 || yLength >= 32000) {
            throw new GeoTiffException(`Image size is too large: x=${xLength}・y=${yLength}`);
        }

        return { x: xLength, y: yLength };
    }

    // メタデータと標高データを結合（Python版の_combine_meta_data_and_contentsと同等）
    private combineMetaDataAndContents(): MeshData[] {
        const metaDataList = this.dem.getMetaDataList();
        const npArrayList = this.dem.npArrayList;

        // メッシュコードでソート
        const sortedMetaData = [...metaDataList].sort((a, b) => a.mesh_code - b.mesh_code);
        const sortedNpArray = [...npArrayList].sort((a, b) => a.mesh_code - b.mesh_code);

        const meshDataList: MeshData[] = [];

        for (let i = 0; i < sortedMetaData.length; i++) {
            const metaData = sortedMetaData[i];
            const npArray = sortedNpArray[i];

            if (metaData.mesh_code !== npArray.mesh_code) {
                throw new GeoTiffException(`Mesh code mismatch: ${metaData.mesh_code} !== ${npArray.mesh_code}`);
            }

            meshDataList.push({
                ...metaData,
                np_array: npArray.array,
            });
        }

        return meshDataList;
    }

    // GeoTIFF用データの作成（Python版のmake_data_for_geotiffと同等）
    public makeDataForGeoTiff(): {
        geoTransform: GeoTransform;
        demArray: number[][];
        imageSize: ImageSize;
    } {
        if (this.onProgress) {
            this.onProgress(1, 4, 'Calculating image size...');
        }

        // 画像サイズの計算
        const imageSize = this.calcImageSize();
        const { x: xLength, y: yLength } = imageSize;

        if (this.onProgress) {
            this.onProgress(2, 4, 'Creating merged array...');
        }

        // 全体をカバーする配列を作成（-9999で初期化）
        const demArray: number[][] = Array(yLength)
            .fill(null)
            .map(() => Array(xLength).fill(-9999));

        const bounds = this.dem.boundsLatLng;

        // ピクセルサイズの計算
        const xPixelSize = (bounds.upper_right.lon - bounds.lower_left.lon) / xLength;
        const yPixelSize = (bounds.lower_left.lat - bounds.upper_right.lat) / yLength;

        if (this.onProgress) {
            this.onProgress(3, 4, 'Combining mesh data...');
        }

        // メタデータと標高値を結合
        const dataList = this.combineMetaDataAndContents();

        // 各メッシュデータを大きな配列に配置
        for (let i = 0; i < dataList.length; i++) {
            const data = dataList[i];

            // 進捗報告
            if (this.onProgress && i % 10 === 0) {
                this.onProgress(3, 4, `Processing mesh ${i + 1}/${dataList.length}`);
            }

            // 読み込む配列の左下座標を取得
            const lowerLeftLat = data.lower_corner.lat;
            const lowerLeftLon = data.lower_corner.lon;

            // (0,0)からの距離を計算
            const latDistance = lowerLeftLat - bounds.lower_left.lat;
            const lonDistance = lowerLeftLon - bounds.lower_left.lon;

            // numpy座標を取得（誤差を排除するため四捨五入）
            const xCoordinate = Math.round(lonDistance / xPixelSize);
            const yCoordinate = Math.round(latDistance / -yPixelSize);

            const xLen = data.grid_length.x;
            const yLen = data.grid_length.y;

            // 配列の配置位置を計算
            const rowStart = Math.max(0, yLength - (yCoordinate + yLen));
            const rowEnd = Math.min(yLength, rowStart + yLen);
            const columnStart = Math.max(0, xCoordinate);
            const columnEnd = Math.min(xLength, columnStart + xLen);

            // データの有効範囲を計算
            const dataRowStart = Math.max(0, yCoordinate + yLen - yLength);
            const dataColStart = Math.max(0, -xCoordinate);

            // 標高値配列を大きな配列に割り当て
            const npArray = data.np_array;
            for (let row = rowStart; row < rowEnd; row++) {
                for (let col = columnStart; col < columnEnd; col++) {
                    const dataRow = dataRowStart + (row - rowStart);
                    const dataCol = dataColStart + (col - columnStart);

                    if (dataRow < npArray.length && dataCol < npArray[dataRow].length) {
                        const value = npArray[dataRow][dataCol];
                        if (value !== -9999) {
                            // 有効なデータのみ上書き
                            demArray[row][col] = value;
                        }
                    }
                }
            }
        }

        if (this.onProgress) {
            this.onProgress(4, 4, 'Creating geo transform...');
        }

        // GeoTransformの作成
        const geoTransform: GeoTransform = {
            upperLeftX: bounds.lower_left.lon, // 左上X座標
            pixelSizeX: xPixelSize, // X方向ピクセルサイズ
            rotationX: 0, // X軸回転
            upperLeftY: bounds.upper_right.lat, // 左上Y座標
            rotationY: 0, // Y軸回転
            pixelSizeY: yPixelSize, // Y方向ピクセルサイズ（負値）
        };

        return {
            geoTransform,
            demArray,
            imageSize,
        };
    }

    // 統計情報の取得
    public getStatistics(): Statistics {
        const data = this.makeDataForGeoTiff();
        const { demArray } = data;

        let validPixels = 0;
        let invalidPixels = 0;
        let minElevation = Infinity;
        let maxElevation = -Infinity;
        let totalElevation = 0;

        for (const row of demArray) {
            for (const elevation of row) {
                if (elevation === -9999) {
                    invalidPixels++;
                } else {
                    validPixels++;
                    minElevation = Math.min(minElevation, elevation);
                    maxElevation = Math.max(maxElevation, elevation);
                    totalElevation += elevation;
                }
            }
        }

        return {
            validPixels,
            invalidPixels,
            minElevation: minElevation === Infinity ? 0 : minElevation,
            maxElevation: maxElevation === -Infinity ? 0 : maxElevation,
            averageElevation: validPixels > 0 ? totalElevation / validPixels : 0,
            bounds: this.dem.boundsLatLng,
            imageSize: data.imageSize,
        };
    }
}

// 使用例とヘルパー関数
export const createGeoTiffFromDem = async (dem: Dem, onProgress?: (current: number, total: number, message: string) => void): Promise<GeoTiffData> => {
    const generator = new GeoTiffGenerator(dem, onProgress);
    const geoTiffData = generator.makeDataForGeoTiff();
    const statistics = generator.getStatistics();

    return {
        ...geoTiffData,
        statistics,
    };
};

// Canvas描画用のヘルパー関数
export const renderDemToCanvas = (demArray: number[][], canvas: HTMLCanvasElement, colorScale: (elevation: number) => string = defaultColorScale): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get canvas context');

    const width = demArray[0]?.length || 0;
    const height = demArray.length;

    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const elevation = demArray[y][x];
            const pixelIndex = (y * width + x) * 4;

            if (elevation === -9999) {
                // 無効データは透明
                data[pixelIndex] = 0; // R
                data[pixelIndex + 1] = 0; // G
                data[pixelIndex + 2] = 0; // B
                data[pixelIndex + 3] = 0; // A
            } else {
                const color = colorScale(elevation);
                const rgb = hexToRgb(color);
                data[pixelIndex] = rgb.r; // R
                data[pixelIndex + 1] = rgb.g; // G
                data[pixelIndex + 2] = rgb.b; // B
                data[pixelIndex + 3] = 255; // A
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);
};

// デフォルトの色スケール（標高に応じた色付け）
const defaultColorScale = (elevation: number): string => {
    if (elevation < 0) return '#0066cc'; // 海
    if (elevation < 100) return '#00cc66'; // 低地
    if (elevation < 500) return '#66cc00'; // 丘陵
    if (elevation < 1000) return '#cccc00'; // 山地
    if (elevation < 2000) return '#cc6600'; // 高山
    return '#cc0000'; // 高峰
};

// HEXカラーをRGBに変換
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16),
          }
        : { r: 0, g: 0, b: 0 };
};
