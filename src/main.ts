import './style.css';

import { createDemFromZipUpload } from './demxml';
import { createGeoTiffFromDem } from './geotiff';

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import GeoTIFF, { writeArrayBuffer } from 'geotiff';

// キャンバス
const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;

const offscreenCanvas = canvas.transferControlToOffscreen();

// WebWorkerを使用してオフスクリーンレンダリングを行う
const threeCanvasWorker = new Worker(new URL('./worker/threeCanvasWorker.ts', import.meta.url), {
    type: 'module',
});

// オフスクリーンレンダリングを使用する場合は、以下のように設定

threeCanvasWorker.postMessage(
    {
        type: 'init',
        canvas: offscreenCanvas,
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: devicePixelRatio,
    },
    [offscreenCanvas],
);

window.addEventListener('resize', (event) => {
    threeCanvasWorker.postMessage({
        type: 'resize',
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: devicePixelRatio,
    });
});

// マウスイベントをワーカーに転送
canvas.addEventListener('mousedown', (event) => {
    threeCanvasWorker.postMessage({
        type: 'mouseEvent',
        eventType: 'mousedown',
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
    });
});

canvas.addEventListener('mousemove', (event) => {
    threeCanvasWorker.postMessage({
        type: 'mouseEvent',
        eventType: 'mousemove',
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
    });
});

canvas.addEventListener('mouseup', (event) => {
    threeCanvasWorker.postMessage({
        type: 'mouseEvent',
        eventType: 'mouseup',
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
    });
});

canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    threeCanvasWorker.postMessage({
        type: 'wheelEvent',
        deltaY: event.deltaY,
        deltaX: event.deltaX,
        deltaZ: event.deltaZ,
    });
});

// タッチイベントも追加（モバイル対応）
canvas.addEventListener('touchstart', (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    threeCanvasWorker.postMessage({
        type: 'mouseEvent',
        eventType: 'mousedown',
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        buttons: 1,
    });
});

canvas.addEventListener('touchmove', (event) => {
    event.preventDefault();
    const touch = event.touches[0];
    threeCanvasWorker.postMessage({
        type: 'mouseEvent',
        eventType: 'mousemove',
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        buttons: 1,
    });
});

canvas.addEventListener('touchend', (event) => {
    event.preventDefault();
    threeCanvasWorker.postMessage({
        type: 'mouseEvent',
        eventType: 'mouseup',
        clientX: 0,
        clientY: 0,
        button: 0,
        buttons: 0,
    });
});

// シンプルなWebWorker TIFF作成
const downloadGeoTiffWithWorker = async (demArray: number[][], geoTransform: number[], filename: string = 'elevation.tif'): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting WebWorker TIFF creation...');
        console.log(`📊 Dimensions: ${demArray[0]?.length} × ${demArray.length}`);

        // WebWorker作成
        const worker = new Worker(new URL('./worker/geotiffWriterWorker.ts', import.meta.url), {
            type: 'module',
        });

        // WebWorkerからのメッセージハンドラー
        worker.onmessage = (e) => {
            const { type, buffer, error, stack } = e.data;

            switch (type) {
                case 'complete':
                    try {
                        // Blobを作成してダウンロード
                        const blob = new Blob([buffer], { type: 'image/tiff' });
                        const url = URL.createObjectURL(blob);

                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);

                        URL.revokeObjectURL(url);
                        worker.terminate();

                        console.log('✅ WebWorker TIFF creation completed successfully');
                        resolve(true);
                    } catch (downloadError) {
                        console.error('❌ Download error:', downloadError);
                        worker.terminate();
                        reject(downloadError);
                    }
                    break;

                case 'error':
                    console.error('❌ WebWorker error:', error);
                    console.error('Stack:', stack);
                    worker.terminate();

                    let errorMessage = 'WebWorkerでのTIFF作成中にエラーが発生しました。\\n\\n';
                    if (error.includes('out of memory')) {
                        errorMessage += '原因: メモリ不足です。\\n対策: データサイズを削減してください。';
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
            console.error('❌ WebWorker error:', error);
            worker.terminate();
            reject(error);
        };

        // WebWorkerにタスクを送信
        worker.postMessage({
            demArray: demArray,
            geoTransform: geoTransform,
        });
    });
};

// ドラッグアンドドロップ機能の初期化
function initializeDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    let dragCounter = 0;

    // ドラッグ開始時
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZone.style.display = 'flex';
    });

    // ドラッグ中
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    // ドラッグ終了時
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
            dropZone.style.display = 'none';
        }
    });

    // ドロップ時
    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.style.display = 'none';

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type === 'application/zip' || file.name.endsWith('.zip')) {
                try {
                    console.log('🚀 Starting DEM processing...');
                    const startTime = performance.now();

                    // プログレスコールバックを定義
                    const progressCallback = (current: number, total: number, fileName: string) => {
                        console.log(`📄 Processing XML file ${current}/${total}: ${fileName}`);

                        // UIに進捗を表示したい場合
                        const progressPercent = Math.round((current / total) * 100);
                        const statusElement = document.getElementById('status-message');
                        if (statusElement) {
                            statusElement.textContent = `Processing XML files... ${progressPercent}% (${current}/${total})`;
                        }
                    };

                    // プログレスコールバックを渡してDEM作成
                    const dem = await createDemFromZipUpload(file, false, progressCallback);

                    const endTime = performance.now();
                    console.log(`⚡ Processing completed in ${(endTime - startTime).toFixed(2)}ms`);

                    // ステータスメッセージをクリア
                    const statusElement = document.getElementById('status-message');
                    if (statusElement) {
                        statusElement.textContent = '';
                    }

                    const geotiffData = await createGeoTiffFromDem(dem);
                    const { geoTransform, demArray, imageSize } = geotiffData;

                    threeCanvasWorker.postMessage({
                        type: 'addMesh',
                        demArray: demArray,
                        geoTransform: geoTransform,
                        imageSize: imageSize,
                    });

                    // GeoTIFFダウンロード
                    // await downloadGeoTiffWithWorker(demArray, geoTransform, 'elevation.tif');
                } catch (error) {
                    console.error('Error creating DEM:', error);
                    alert('ZIPファイルの処理中にエラーが発生しました');
                }
            } else {
                alert('ZIPファイルをドロップしてください');
            }
        }
    });
}

// DOMが読み込まれた後に初期化
document.addEventListener('DOMContentLoaded', () => {
    initializeDragAndDrop();
});
