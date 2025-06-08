import "./style.css";

import { createDemFromUpload } from "./utils/demxml";
import { createGeoTiffFromDem } from "./utils/geotiff";
import { loadingEnd, loadingStart } from "./utils/loading";

import type { GeoTransform } from "./utils/geotiff";
import { addMapLayerFromDem, toggleMapView } from "./map";

import { uniforms } from "./three/uniforms";

import { Pane } from "tweakpane";

// キャンバス
const canvas = document.getElementById("three-canvas") as HTMLCanvasElement;
const offscreenCanvas = canvas.transferControlToOffscreen();

// WebWorkerを使用してオフスクリーンレンダリングを行う
const threeCanvasWorker = new Worker(new URL("./three/worker.three-canvas.ts", import.meta.url), {
    type: "module",
});

// 初期化
threeCanvasWorker.postMessage(
    {
        type: "init",
        canvas: offscreenCanvas,
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: devicePixelRatio,
    },
    [offscreenCanvas],
);

// リザイズ
window.addEventListener("resize", () => {
    threeCanvasWorker.postMessage({
        type: "resize",
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: devicePixelRatio,
    });
});

// マウスイベントをワーカーに転送
canvas.addEventListener("mousedown", (event) => {
    threeCanvasWorker.postMessage({
        type: "mouseEvent",
        eventType: "mousedown",
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
    });
});

canvas.addEventListener("mousemove", (event) => {
    threeCanvasWorker.postMessage({
        type: "mouseEvent",
        eventType: "mousemove",
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
    });
});

canvas.addEventListener("mouseup", (event) => {
    threeCanvasWorker.postMessage({
        type: "mouseEvent",
        eventType: "mouseup",
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
    });
});

canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    threeCanvasWorker.postMessage({
        type: "wheelEvent",
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        deltaZ: event.deltaZ,
    });
});

// タッチイベントも追加（モバイル対応）
canvas.addEventListener("touchstart", (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    threeCanvasWorker.postMessage({
        type: "mouseEvent",
        eventType: "mousedown",
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        buttons: 1,
    });
});

canvas.addEventListener("touchmove", (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    threeCanvasWorker.postMessage({
        type: "mouseEvent",
        eventType: "mousemove",
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        buttons: 1,
    });
});

canvas.addEventListener("touchend", (event) => {
    event.preventDefault();
    threeCanvasWorker.postMessage({
        type: "mouseEvent",
        eventType: "mouseup",
        clientX: 0,
        clientY: 0,
        button: 0,
        buttons: 0,
    });
});

const pane = new Pane({
    title: "パラメーター",
    container: document.getElementById("tweakpane-3d") as HTMLElement,
});
pane.addBinding(uniforms.u_scale, "value", {
    min: 0,
    max: 10,
    label: "高さスケール",
    step: 0.01,
}).on("change", (ev) => {
    uniforms.u_scale.value = ev.value;
    threeCanvasWorker.postMessage({ type: "updateUniforms", key: "u_scale", value: ev.value });
});

// シンプルなWebWorker TIFF作成
const downloadGeoTiffWithWorker = async (
    demArray: number[][],
    geoTransform: GeoTransform,
    filename: string,
    dataType: "single" | "mapbox" = "single",
): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        console.log("Starting WebWorker TIFF creation...");
        console.log(`Dimensions: ${demArray[0]?.length} × ${demArray.length}`);

        // データ検証
        if (dataType === "single") {
            // WebWorker作成
            const worker = new Worker(
                new URL("./writer/worker.geotiff-writer.ts", import.meta.url),
                {
                    type: "module",
                },
            );

            // WebWorkerからのメッセージハンドラー
            worker.onmessage = (e) => {
                const { type, buffer, error, stack } = e.data;

                switch (type) {
                    case "complete":
                        try {
                            // Blobを作成してダウンロード
                            const blob = new Blob([buffer], { type: "image/tiff" });
                            const url = URL.createObjectURL(blob);

                            const a = document.createElement("a");
                            a.href = url;
                            a.download = filename;
                            a.style.display = "none";
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);

                            URL.revokeObjectURL(url);
                            worker.terminate();

                            resolve(true);
                        } catch (downloadError) {
                            console.error("Download error:", downloadError);
                            worker.terminate();
                            reject(downloadError);
                        }
                        break;

                    case "error":
                        console.error("WebWorker error:", error);
                        console.error("Stack:", stack);
                        worker.terminate();

                        let errorMessage = "WebWorkerでのTIFF作成中にエラーが発生しました。\\n\\n";
                        if (error.includes("out of memory")) {
                            errorMessage +=
                                "原因: メモリ不足です。\\n対策: データサイズを削減してください。";
                        } else {
                            errorMessage += `詳細: ${error}`;
                        }

                        alert(errorMessage);
                        resolve(false);
                        break;
                }
            };

            // WebWorkerエラーハンドラー
            worker.onerror = (error) => {
                console.error("WebWorker error:", error);
                worker.terminate();
                reject(error);
            };

            // WebWorkerにタスクを送信
            worker.postMessage({
                demArray: demArray,
                geoTransform: geoTransform,
            });
        } else {
            // Mapbox GL用のWebWorker作成
            const worker = new Worker(
                new URL("./writer/worker.terrain-rgb-writer.ts", import.meta.url),
                {
                    type: "module",
                },
            );

            // WebWorkerからのメッセージハンドラー
            worker.onmessage = (e) => {
                const { type, buffer, error, stack } = e.data;

                switch (type) {
                    case "complete":
                        try {
                            // Blobを作成してダウンロード
                            const blob = new Blob([buffer], { type: "image/tiff" });
                            const url = URL.createObjectURL(blob);

                            const a = document.createElement("a");
                            a.href = url;
                            a.download = filename;
                            a.style.display = "none";
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);

                            URL.revokeObjectURL(url);
                            worker.terminate();

                            console.log("Mapbox GL WebWorker TIFF creation completed successfully");
                            resolve(true);
                        } catch (downloadError) {
                            console.error(" Download error:", downloadError);
                            worker.terminate();
                            reject(downloadError);
                        }
                        break;

                    case "error":
                        console.error("Mapbox GL WebWorker error:", error);
                        console.error("Stack:", stack);
                        worker.terminate();
                        alert(`Mapbox GL WebWorkerでのTIFF作成中にエラーが発生しました: ${error}`);
                        resolve(false);
                        break;
                }
            };

            // WebWorkerエラーハンドラー
            worker.onerror = (error) => {
                console.error("Mapbox GL WebWorker error:", error);
                worker.terminate();
                reject(error);
            };
            // WebWorkerにタスクを送信
            worker.postMessage({
                demArray: demArray,
                geoTransform: geoTransform,
            });
        }
    });
};

const processFile = async (input: File | File[]) => {
    loadingStart();
    const isInputArray = Array.isArray(input);
    const firstFile = isInputArray ? input[0] : input;

    console.log(`Processing ${isInputArray ? "multiple files" : "single file"}: ${firstFile.name}`);

    // ZIPファイル、XMLファイル、または複数ファイルかどうかをチェック
    const isZipFile =
        !isInputArray &&
        (firstFile.type === "application/zip" ||
            firstFile.type === "application/x-zip-compressed" ||
            firstFile.name.toLowerCase().endsWith(".zip"));

    const isXmlFile = !isInputArray && firstFile.name.toLowerCase().endsWith(".xml");
    const hasXmlFiles =
        isInputArray && input.some((file) => file.name.toLowerCase().endsWith(".xml"));

    if (isZipFile || isXmlFile || hasXmlFiles) {
        try {
            console.log("Starting DEM processing...");
            const startTime = performance.now();

            // プログレスコールバックを定義
            const progressCallback = (current: number, total: number, fileName: string) => {
                console.log(`📄 Processing XML file ${current}/${total}: ${fileName}`);
            };

            // プログレスコールバックを渡してDEM作成
            const dem = await createDemFromUpload(input, false, progressCallback);

            const endTime = performance.now();
            console.log(`⚡ Processing completed in ${(endTime - startTime).toFixed(2)}ms`);

            const geotiffData = await createGeoTiffFromDem(dem);
            const { geoTransform, demArray, statistics } = geotiffData;

            loaded();

            await addMapLayerFromDem(geotiffData);

            threeCanvasWorker.postMessage({
                type: "addMesh",
                demArray: demArray,
                geoTransform: geoTransform,
                statistics: statistics,
            });

            const exportButton = document.getElementById("export-button") as HTMLButtonElement;
            if (exportButton) {
                exportButton.addEventListener("click", async () => {
                    // GeoTIFFダウンロード
                    await downloadGeoTiffWithWorker(
                        demArray,
                        geoTransform,
                        `dem.tiff`, // ダウンロードするファイル名
                        "single", // または "mapbox" を指定
                    ).catch((error) => {
                        console.error("Error downloading GeoTIFF:", error);
                        alert(
                            `GeoTIFFのダウンロード中にエラーが発生しました: ${error.message || error}`,
                        );
                    });
                });
            }
        } catch (error) {
            if (error instanceof Error) {
                console.error("Error creating DEM:", error);
                console.error("Error details:", error.message || error);
                alert(
                    `ファイルの処理中にエラーが発生しました。対応していないファイルです。: ${error.message || error}`,
                );
                await loadingEnd();
            }
        }
    } else {
        alert("ZIPファイル、XMLファイル、またはXMLファイルを含むフォルダをドロップしてください");
        await loadingEnd();
    }
};
const dropZone = document.getElementById("drop-zone");
// ドラッグアンドドロップ機能の初期化
const initializeDragAndDrop = () => {
    if (!dropZone) return;
    let dragCounter = 0;

    // ドラッグ開始時
    document.addEventListener("dragenter", (e) => {
        e.preventDefault();
        dragCounter++;
    });
    // ドラッグ中
    document.addEventListener("dragover", (e) => {
        e.preventDefault();
    });
    // ドラッグ終了時
    document.addEventListener("dragleave", (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
        }
    });

    const fileInput = document.getElementById("fileInput") as HTMLInputElement;

    if (fileInput) {
        fileInput.addEventListener("change", async (e) => {
            e.preventDefault();
            dragCounter = 0;
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                const file = target.files[0];
                processFile(file);
            }
        });
    }

    // ドロップ時
    document.addEventListener("drop", async (e) => {
        e.preventDefault();
        dragCounter = 0;

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            processFile(file);
        }
    });
};

const loaded = async () => {
    if (dropZone) dropZone.style.display = "none";
    const pane = document.getElementById("pane");
    if (pane) {
        pane.style.display = "block"; // パネルを表示
    }
    await loadingEnd();
};

// DOMが読み込まれた後に初期化
document.addEventListener("DOMContentLoaded", () => {
    initializeDragAndDrop();
});

const sampleDem10bBtn = document.getElementById("sample-dem10b") as HTMLButtonElement;
if (sampleDem10bBtn) {
    sampleDem10bBtn.addEventListener("click", async () => {
        try {
            const response = await fetch("./sample/sample-dem10b.zip");

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // ArrayBufferからBlobを作成（正しいMIMEタイプを指定）
            const blob = new Blob([arrayBuffer], { type: "application/zip" });

            // Fileオブジェクトを作成
            const file = new File([blob], "sample-dem10b.zip", {
                type: "application/zip",
                lastModified: Date.now(),
            });

            await processFile(file);
            if (dropZone) dropZone.style.display = "none"; // ドロップゾーンを非表示にする
        } catch (error) {
            console.error("Error fetching or processing sample DEM:", error);
            alert("サンプルDEMファイルの取得または処理に失敗しました");
        }
    });
}

const toggleViewButton = document.getElementById("toggle-view-button");

let isViewMpde: "map" | "3d" = "map"; // 初期状態は3Dビュー

if (toggleViewButton) {
    toggleViewButton.addEventListener("click", () => {
        toggleViewButton.classList.toggle("c-mode-map");
        toggleViewButton.classList.toggle("c-mode-3d");

        if (isViewMpde === "map") {
            isViewMpde = "3d";

            threeCanvasWorker.postMessage({ type: "toggleView", mode: true });
            toggleMapView(false);
        } else {
            isViewMpde = "map";

            threeCanvasWorker.postMessage({ type: "toggleView", mode: false });
            toggleMapView(true);
        }
    });
}
