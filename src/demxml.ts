import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

// 型定義
interface LowerCorner {
    lat: number;
    lon: number;
}

interface UpperCorner {
    lat: number;
    lon: number;
}

interface GridLength {
    x: number;
    y: number;
}

interface StartPoint {
    x: number;
    y: number;
}

interface PixelSize {
    x: number;
    y: number;
}

export interface MetaData {
    mesh_code: number;
    lower_corner: LowerCorner;
    upper_corner: UpperCorner;
    grid_length: GridLength;
    start_point: StartPoint;
    pixel_size: PixelSize;
}

interface Elevation {
    mesh_code: number;
    items: string[];
}

export interface DemContent {
    mesh_code: number;
    meta_data: MetaData;
    elevation: Elevation;
}

interface BoundsLatLng {
    lower_left: { lat: number; lon: number };
    upper_right: { lat: number; lon: number };
}

interface NpArrayData {
    mesh_code: number;
    array: number[][];
}

import type { ParseXmlTask, ParseXmlResult } from './worker/xmlParseWorker';

export class ParallelXmlParser {
    private workers: Worker[] = [];
    private readonly maxWorkers = 4;

    constructor() {
        // 4つのWorkerを初期化
        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = new Worker(new URL('./worker/xmlParseWorker.ts', import.meta.url), {
                type: 'module',
            });
            this.workers.push(worker);
        }
    }

    async parseXmlFiles(xmlTexts: string[], seaAtZero: boolean = false): Promise<DemContent[]> {
        return new Promise((resolve, reject) => {
            const results: DemContent[] = new Array(xmlTexts.length);
            const errors: string[] = [];
            let completedTasks = 0;
            let nextTaskIndex = 0;

            const processNextTask = (workerIndex: number) => {
                if (nextTaskIndex >= xmlTexts.length) {
                    return;
                }

                const taskId = nextTaskIndex++;
                const task: ParseXmlTask = {
                    id: taskId,
                    xmlText: xmlTexts[taskId],
                    seaAtZero,
                };

                this.workers[workerIndex].postMessage(task);
            };

            // 各Workerにメッセージハンドラーを設定
            this.workers.forEach((worker, workerIndex) => {
                worker.onmessage = (e) => {
                    const result: ParseXmlResult = e.data;

                    if (result.error) {
                        errors.push(`Task ${result.id}: ${result.error}`);
                    } else {
                        results[result.id] = result.content;
                    }

                    completedTasks++;

                    // 次のタスクがあれば処理
                    processNextTask(workerIndex);

                    // 全タスク完了チェック
                    if (completedTasks === xmlTexts.length) {
                        if (errors.length > 0) {
                            reject(new Error(`XML parsing errors: ${errors.join(', ')}`));
                        } else {
                            resolve(results);
                        }
                    }
                };

                worker.onerror = (error) => {
                    reject(new Error(`Worker error: ${error.message}`));
                };
            });

            // 初期タスクを各Workerに配布
            for (let i = 0; i < Math.min(this.maxWorkers, xmlTexts.length); i++) {
                processNextTask(i);
            }
        });
    }

    terminate() {
        this.workers.forEach((worker) => worker.terminate());
        this.workers = [];
    }
}

// カスタムエラークラス
export class DemInputXmlException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DemInputXmlException';
    }
}

export class Dem {
    private xmlTexts: string[];
    private allContentList: DemContent[] = [];
    private meshCodeList: number[] = [];
    private metaDataList: MetaData[] = [];
    private seaAtZero: boolean;

    public npArrayList: NpArrayData[] = [];
    public boundsLatLng: BoundsLatLng = {
        lower_left: { lat: 0, lon: 0 },
        upper_right: { lat: 0, lon: 0 },
    };

    constructor(xmlTexts: string | string[], seaAtZero: boolean = false) {
        this.xmlTexts = Array.isArray(xmlTexts) ? xmlTexts : [xmlTexts];
        this.seaAtZero = seaAtZero;
    }

    // メインの処理メソッド - 並列処理版
    public async contentsToArray(): Promise<void> {
        console.log(`🚀 Starting parallel XML parsing with ${this.xmlTexts.length} files`);

        const parser = new ParallelXmlParser();

        try {
            // 並列でXMLファイルを解析
            this.allContentList = await parser.parseXmlFiles(this.xmlTexts, this.seaAtZero);

            // メッシュコードでソート（地理的順序を保証）
            this.allContentList.sort((a, b) => a.mesh_code - b.mesh_code);

            console.log(`✅ Parallel XML parsing completed: ${this.allContentList.length} files processed`);

            this.getMetadataList();
            this.storeNpArrayList();
            this.storeBoundsLatLng();
        } finally {
            // Workerを終了
            parser.terminate();
        }
    }

    // メインの処理メソッド
    // 元のメソッドも残しておく（デバッグ用）
    public async contentsToArraySequential(): Promise<void> {
        // 全XMLファイルからコンテンツを取得
        for (const xmlText of this.xmlTexts) {
            const content = await this.getXmlContent(xmlText);
            this.allContentList.push(content);
        }

        // メッシュコードでソート
        this.allContentList.sort((a, b) => a.mesh_code - b.mesh_code);

        this.getMetadataList();
        this.storeNpArrayList();
        this.storeBoundsLatLng();
    }

    // XMLコンテンツの解析
    private async getXmlContent(xmlText: string): Promise<DemContent> {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            processEntities: true,
            trimValues: true,
            removeNSPrefix: false, // 名前空間プレフィックスを保持
            parseAttributeValue: false,
        });

        let jsonObj: any;
        try {
            jsonObj = parser.parse(xmlText);
        } catch (error) {
            throw new DemInputXmlException('Failed to parse XML file.');
        }

        // デバッグ用ログ
        console.log('Parsed JSON structure:', JSON.stringify(jsonObj, null, 2));

        // ルート要素の取得 - Python側と同じ順序で試行
        const dataset = jsonObj['dataset:Dataset'] ?? jsonObj['Dataset'];
        if (!dataset) {
            console.error('Available root keys:', Object.keys(jsonObj));
            throw new DemInputXmlException('Dataset root not found');
        }

        const dem = dataset['dataset:DEM'] ?? dataset['DEM'];
        if (!dem) {
            console.error('Available dataset keys:', Object.keys(dataset));
            throw new DemInputXmlException('DEM root not found');
        }

        try {
            // メッシュコード - Python側と同じXPathパターン
            const meshCode = Number(dem['dataset:mesh'] ?? dem['mesh']);
            console.log('Mesh Code:', meshCode);

            // メタデータ取得 - Python側のXPathパターンに合わせる
            const coverage = dem['dataset:coverage'] ?? dem['coverage'];
            if (!coverage) {
                console.error('Available DEM keys:', Object.keys(dem));
                throw new DemInputXmlException('coverage not found');
            }

            const boundedBy = coverage['gml:boundedBy'] ?? coverage['boundedBy'];
            const envelope = boundedBy['gml:Envelope'] ?? boundedBy['Envelope'];
            const lowerCorner = envelope['gml:lowerCorner'] ?? envelope['lowerCorner'];
            const upperCorner = envelope['gml:upperCorner'] ?? envelope['upperCorner'];

            const gridDomain = coverage['gml:gridDomain'] ?? coverage['gridDomain'];
            const grid = gridDomain['gml:Grid'] ?? gridDomain['Grid'];

            // 正しい階層で gml:high を取得
            const gridLimits = grid['gml:limits'] ?? grid['limits'];
            const gridEnvelope = gridLimits['gml:GridEnvelope'] ?? gridLimits['GridEnvelope'];
            const gridLength = gridEnvelope['gml:high'] ?? gridEnvelope['high'];

            // デバッグ用ログ
            console.log('gridDomain:', gridDomain);
            console.log('grid:', grid);
            console.log('gridLimits:', gridLimits);
            console.log('gridEnvelope:', gridEnvelope);
            console.log('gridLength (raw):', gridLength);

            const coverageFunction = coverage['gml:coverageFunction'] ?? coverage['coverageFunction'];
            const gridFunction = coverageFunction['gml:GridFunction'] ?? coverageFunction['GridFunction'];
            const startPoint = gridFunction['gml:startPoint'] ?? gridFunction['startPoint'];

            // 標高値
            const rangeSet = coverage['gml:rangeSet'] ?? coverage['rangeSet'];
            const dataBlock = rangeSet['gml:DataBlock'] ?? rangeSet['DataBlock'];
            const tupleList = dataBlock['gml:tupleList'] ?? dataBlock['tupleList'];

            // 必須フィールドの存在チェック
            if (!gridLength) {
                console.error('Grid structure:', JSON.stringify(grid, null, 2));
                console.error('GridLimits structure:', JSON.stringify(gridLimits, null, 2));
                console.error('GridEnvelope structure:', JSON.stringify(gridEnvelope, null, 2));
                throw new DemInputXmlException('grid_length (gml:high) not found in gml:GridEnvelope');
            }
            if (!lowerCorner || !upperCorner) {
                throw new DemInputXmlException('Coordinate bounds not found in XML');
            }
            if (!startPoint) {
                throw new DemInputXmlException('start_point not found in XML');
            }
            if (!tupleList) {
                throw new DemInputXmlException('tupleList not found in XML');
            }

            // 生メタデータの作成
            const rawMetadata = {
                mesh_code: meshCode,
                lower_corner: lowerCorner,
                upper_corner: upperCorner,
                grid_length: gridLength,
                start_point: startPoint,
            };

            // メタデータの整形
            const metaData = this.formatMetadata(rawMetadata);

            // 標高値リストの処理
            const cleanTupleList = tupleList.trim();
            let items: string[];

            if (this.seaAtZero) {
                // 海域を0に置換
                items = cleanTupleList.split('\n').map((line: string) => {
                    const parts = line.split(',');
                    if ((parts[0] === '海水面' || parts[0] === '海水底面') && parts[1] === '-9999.') {
                        return '0.0';
                    }
                    return parts[1];
                });
            } else {
                items = cleanTupleList.split('\n').map((line: string) => line.split(',')[1]);
            }

            const elevation: Elevation = {
                mesh_code: meshCode,
                items,
            };

            return {
                mesh_code: meshCode,
                meta_data: metaData,
                elevation,
            };
        } catch (error) {
            throw new DemInputXmlException('Incorrect XML file format.');
        }
    }

    // メタデータの整形 - Python側の_format_metadata()と完全に一致
    private formatMetadata(rawMetadata: any): MetaData {
        console.log('Raw metadata for formatting:', rawMetadata);

        // Python側と同じ処理順序
        const lowers = rawMetadata.lower_corner.split(' ');
        const lowerCorner: LowerCorner = {
            lat: parseFloat(lowers[0]),
            lon: parseFloat(lowers[1]),
        };

        const uppers = rawMetadata.upper_corner.split(' ');
        const upperCorner: UpperCorner = {
            lat: parseFloat(uppers[0]),
            lon: parseFloat(uppers[1]),
        };

        const grids = rawMetadata.grid_length.split(' ');
        const gridLength: GridLength = {
            x: parseInt(grids[0]) + 1, // Python: int(grids[0]) + 1
            y: parseInt(grids[1]) + 1, // Python: int(grids[1]) + 1
        };

        const startPoints = rawMetadata.start_point.split(' ');
        const startPoint: StartPoint = {
            x: parseInt(startPoints[0]),
            y: parseInt(startPoints[1]),
        };

        // Python側と同じピクセルサイズ計算
        const pixelSize: PixelSize = {
            x: (upperCorner.lon - lowerCorner.lon) / gridLength.x,
            y: (lowerCorner.lat - upperCorner.lat) / gridLength.y, // 注意: lower - upper （Python側と同じ）
        };

        const result = {
            mesh_code: rawMetadata.mesh_code,
            lower_corner: lowerCorner,
            upper_corner: upperCorner,
            grid_length: gridLength,
            start_point: startPoint,
            pixel_size: pixelSize,
        };

        console.log('Formatted metadata:', result);
        return result;
    }

    // メッシュコードのチェック
    private checkMeshCodes(): void {
        const thirdMeshCodes: number[] = [];
        const secondMeshCodes: number[] = [];

        for (const meshCode of this.meshCodeList) {
            const strMesh = meshCode.toString();
            if (strMesh.length === 6) {
                secondMeshCodes.push(meshCode);
            } else if (strMesh.length === 8) {
                thirdMeshCodes.push(meshCode);
            } else {
                throw new DemInputXmlException(`Incorrect Mesh code: mesh_code=${meshCode}`);
            }
        }

        if (thirdMeshCodes.length > 0 && secondMeshCodes.length > 0) {
            throw new DemInputXmlException('Mixed mesh format (2nd mesh and 3rd mesh)');
        }
    }

    // メタデータリストの作成
    private getMetadataList(): void {
        this.meshCodeList = this.allContentList.map((item) => item.mesh_code);
        this.checkMeshCodes();
        this.metaDataList = this.allContentList.map((item) => item.meta_data);
    }

    // 境界座標の保存
    private storeBoundsLatLng(): void {
        const lowerLeftLat = Math.min(...this.metaDataList.map((meta) => meta.lower_corner.lat));
        const lowerLeftLon = Math.min(...this.metaDataList.map((meta) => meta.lower_corner.lon));
        const upperRightLat = Math.max(...this.metaDataList.map((meta) => meta.upper_corner.lat));
        const upperRightLon = Math.max(...this.metaDataList.map((meta) => meta.upper_corner.lon));

        this.boundsLatLng = {
            lower_left: { lat: lowerLeftLat, lon: lowerLeftLon },
            upper_right: { lat: upperRightLat, lon: upperRightLon },
        };
    }

    // NumPy配列の取得
    private getNpArray(content: DemContent): NpArrayData {
        const meshCode = content.mesh_code;
        const metaData = content.meta_data;
        const elevation = content.elevation.items;

        const xLength = metaData.grid_length.x;
        const yLength = metaData.grid_length.y;

        // 2次元配列の初期化（-9999で埋める）
        const array: number[][] = Array(yLength)
            .fill(null)
            .map(() => Array(xLength).fill(-9999));

        const startPointX = metaData.start_point.x;
        const startPointY = metaData.start_point.y;

        // データは北西から南東に配列されているため、各行ごとに座標を配列に格納
        let index = 0;
        let currentStartPointX = startPointX;

        for (let y = startPointY; y < yLength; y++) {
            for (let x = currentStartPointX; x < xLength; x++) {
                try {
                    const insertValue = parseFloat(elevation[index]);
                    if (!isNaN(insertValue)) {
                        array[y][x] = insertValue;
                    }
                } catch (error) {
                    // データの行数とグリッドのサイズが必ずしも一致しない場合がある
                    break;
                }
                index++;
            }
            currentStartPointX = 0;
        }

        return {
            mesh_code: meshCode,
            array,
        };
    }

    // NumPy配列リストの保存
    private storeNpArrayList(): void {
        this.npArrayList = this.allContentList.map((content) => this.getNpArray(content));
    }

    // Getter methods for accessing processed data
    public getAllContentList(): DemContent[] {
        return this.allContentList;
    }

    public getMeshCodeList(): number[] {
        return this.meshCodeList;
    }

    public getMetaDataList(): MetaData[] {
        return this.metaDataList;
    }
}

// ブラウザ用：フォルダアップロードからDEMオブジェクトを作成
export const createDemFromFolderUpload = async (files: FileList | File[], seaAtZero: boolean = false, onProgress?: (current: number, total: number, fileName: string) => void): Promise<Dem> => {
    const fileArray = Array.from(files);

    // XMLファイルのみをフィルタリング
    const xmlFiles = fileArray.filter((file) => file.name.toLowerCase().endsWith('.xml'));

    if (xmlFiles.length === 0) {
        throw new DemInputXmlException('No XML files found in the uploaded files.');
    }

    // 各XMLファイルを読み込み
    const xmlStrings: string[] = [];

    for (let i = 0; i < xmlFiles.length; i++) {
        const file = xmlFiles[i];

        // 進捗報告
        if (onProgress) {
            onProgress(i + 1, xmlFiles.length, file.name);
        }

        try {
            const xmlContent = await readFileAsText(file);
            xmlStrings.push(xmlContent);
        } catch (error) {
            throw new DemInputXmlException(`Failed to read XML file: ${file.name}`);
        }
    }

    // DEMオブジェクトの作成と処理
    const dem = new Dem(xmlStrings, seaAtZero);
    await dem.contentsToArray();

    return dem;
};

// ブラウザ用：ZIPファイルからDEMオブジェクトを作成
export const createDemFromZipUpload = async (zipFile: File, seaAtZero: boolean = false, onProgress?: (current: number, total: number, fileName: string) => void): Promise<Dem> => {
    // 動的にJSZipをインポート（使用時のみロード）

    try {
        const zip = await JSZip.loadAsync(zipFile);
        const xmlFiles: string[] = [];
        const xmlFileNames: string[] = [];

        // ZIPファイル内のXMLファイルを取得
        zip.forEach((relativePath, file) => {
            if (!file.dir && relativePath.toLowerCase().endsWith('.xml')) {
                xmlFileNames.push(relativePath);
            }
        });

        if (xmlFileNames.length === 0) {
            throw new DemInputXmlException('No XML files found in the ZIP file.');
        }

        // 各XMLファイルを読み込み
        for (let i = 0; i < xmlFileNames.length; i++) {
            const fileName = xmlFileNames[i];

            // 進捗報告
            if (onProgress) {
                onProgress(i + 1, xmlFileNames.length, fileName);
            }

            try {
                const xmlContent = await zip.file(fileName)?.async('string');
                if (xmlContent) {
                    xmlFiles.push(xmlContent);
                }
            } catch (error) {
                throw new DemInputXmlException(`Failed to read XML file from ZIP: ${fileName}`);
            }
        }

        // DEMオブジェクトの作成と処理
        const dem = new Dem(xmlFiles, seaAtZero);
        await dem.contentsToArray();

        return dem;
    } catch (error) {
        if (error instanceof DemInputXmlException) {
            throw error;
        }
        throw new DemInputXmlException('Failed to process ZIP file.');
    }
};

// ファイルをテキストとして読み込むヘルパー関数
const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            if (event.target?.result) {
                resolve(event.target.result as string);
            } else {
                reject(new Error('Failed to read file'));
            }
        };

        reader.onerror = () => {
            reject(new Error('Error reading file'));
        };

        reader.readAsText(file, 'utf-8');
    });
};

// 従来の文字列ベースの関数（後方互換性のため）
export const createDemFromXmlStrings = async (xmlStrings: string | string[], seaAtZero: boolean = false): Promise<Dem> => {
    const dem = new Dem(xmlStrings, seaAtZero);
    await dem.contentsToArray();
    return dem;
};

// 使用例とHTMLサンプル
export const createFileUploadHandler = (onSuccess: (dem: Dem) => void, onError: (error: Error) => void, onProgress?: (current: number, total: number, fileName: string) => void) => {
    return async (event: Event) => {
        const input = event.target as HTMLInputElement;
        const files = input.files;

        if (!files || files.length === 0) {
            onError(new Error('No files selected'));
            return;
        }

        try {
            let dem: Dem;

            // 単一ZIPファイルの場合
            if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
                dem = await createDemFromZipUpload(files[0], false, onProgress);
            }
            // 複数ファイルまたはフォルダの場合
            else {
                dem = await createDemFromFolderUpload(files, false, onProgress);
            }

            onSuccess(dem);
        } catch (error) {
            onError(error as Error);
        }
    };
};
