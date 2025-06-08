import JSZip from "jszip";
import type { ParseXmlTask, ParseXmlResult } from "./worker.xml-parser";

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

export class ParallelXmlParser {
    private workers: Worker[] = [];
    private readonly maxWorkers = 4;

    constructor() {
        // 4つのWorkerを初期化
        for (let i = 0; i < this.maxWorkers; i++) {
            const worker = new Worker(new URL("./worker.xml-parser.ts", import.meta.url), {
                type: "module",
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
                            reject(new Error(`XML parsing errors: ${errors.join(", ")}`));
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
        this.name = "DemInputXmlException";
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
        console.log(`Starting parallel XML parsing with ${this.xmlTexts.length} files`);

        const parser = new ParallelXmlParser();

        try {
            // 並列でXMLファイルを解析
            this.allContentList = await parser.parseXmlFiles(this.xmlTexts, this.seaAtZero);

            // メッシュコードでソート（地理的順序を保証）
            this.allContentList.sort((a, b) => a.mesh_code - b.mesh_code);

            console.log(
                `Parallel XML parsing completed: ${this.allContentList.length} files processed`,
            );

            this.getMetadataList();
            this.storeNpArrayList();
            this.storeBoundsLatLng();
        } finally {
            // Workerを終了
            parser.terminate();
        }
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
            throw new DemInputXmlException("Mixed mesh format (2nd mesh and 3rd mesh)");
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

// ブラウザ用：ZIPファイルからDEMオブジェクトを作成
export const createDemFromZipUpload = async (
    input: File | File[],
    seaAtZero: boolean = false,
    onProgress?: (current: number, total: number, fileName: string) => void,
): Promise<Dem> => {
    try {
        const xmlFiles: string[] = [];
        const xmlFileNames: string[] = [];

        if (Array.isArray(input)) {
            // 複数ファイル（フォルダドロップ）の場合
            const xmlInputFiles = input.filter((file) => file.name.toLowerCase().endsWith(".xml"));

            if (xmlInputFiles.length === 0) {
                throw new DemInputXmlException("No XML files found in the selected files.");
            }

            // 各XMLファイルを読み込み
            for (let i = 0; i < xmlInputFiles.length; i++) {
                const file = xmlInputFiles[i];

                // 進捗報告
                if (onProgress) {
                    onProgress(i + 1, xmlInputFiles.length, file.name);
                }

                try {
                    const xmlContent = await file.text();
                    xmlFiles.push(xmlContent);
                    xmlFileNames.push(file.name);
                } catch (error) {
                    throw new DemInputXmlException(`Failed to read XML file: ${file.name}`);
                }
            }
        } else {
            // 単一ファイルの場合
            if (input.name.toLowerCase().endsWith(".xml")) {
                // 単一XMLファイル
                try {
                    const xmlContent = await input.text();
                    xmlFiles.push(xmlContent);
                    xmlFileNames.push(input.name);
                } catch (error) {
                    throw new DemInputXmlException(`Failed to read XML file: ${input.name}`);
                }
            } else {
                // ZIPファイル
                const zip = await JSZip.loadAsync(input);

                // ZIPファイル内のXMLファイルを取得
                zip.forEach((relativePath, file) => {
                    if (!file.dir && relativePath.toLowerCase().endsWith(".xml")) {
                        xmlFileNames.push(relativePath);
                    }
                });

                if (xmlFileNames.length === 0) {
                    throw new DemInputXmlException("No XML files found in the ZIP file.");
                }

                // 各XMLファイルを読み込み
                for (let i = 0; i < xmlFileNames.length; i++) {
                    const fileName = xmlFileNames[i];

                    // 進捗報告
                    if (onProgress) {
                        onProgress(i + 1, xmlFileNames.length, fileName);
                    }

                    try {
                        const xmlContent = await zip.file(fileName)?.async("string");
                        if (xmlContent) {
                            xmlFiles.push(xmlContent);
                        }
                    } catch (error) {
                        throw new DemInputXmlException(
                            `Failed to read XML file from ZIP: ${fileName}`,
                        );
                    }
                }
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
        throw new DemInputXmlException("Failed to process input files.");
    }
};
