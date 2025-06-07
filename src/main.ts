import './style.css';

import { createDemFromZipUpload } from './demxml';
import { createGeoTiffFromDem, renderDemToCanvas } from './demxml2';

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import GeoTIFF, { writeArrayBuffer } from 'geotiff';

// シーンの作成
const scene = new THREE.Scene();

// カメラ
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);

camera.position.set(100, 100, 100);
scene.add(camera);

// キャンバス
const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const context = canvas.getContext('webgl2') as WebGL2RenderingContext;

// コントロール
const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.enablePan = false;
orbitControls.enableZoom = false;

const zoomControls = new TrackballControls(camera, canvas);
zoomControls.noPan = true;
zoomControls.noRotate = true;
zoomControls.zoomSpeed = 0.2;

const grid = new THREE.GridHelper(1000, 100);

scene.add(grid);

// レンダラー
const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// 画面リサイズ時にキャンバスもリサイズ
const onResize = () => {
    // サイズを取得
    const width = window.innerWidth;
    const height = window.innerHeight;

    // レンダラーのサイズを調整する
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);

    // カメラのアスペクト比を正す
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
};
window.addEventListener('resize', onResize);

// アニメーション
const animate = () => {
    requestAnimationFrame(animate);
    const target = orbitControls.target;
    orbitControls.update();
    zoomControls.target.set(target.x, target.y, target.z);
    zoomControls.update();
    renderer.render(scene, camera);
};
animate();

// プログレス付きWebWorker TIFF作成
const downloadGeoTiffWithWorker = async (
    demArray: number[][],
    geoTransform: number[],
    filename: string = 'elevation.tif',
    includeGeoInfo: boolean = true,
    onProgress?: (message: string, progress: number) => void,
): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting WebWorker TIFF creation...');
        console.log(`📊 Dimensions: ${demArray[0]?.length} × ${demArray.length}`);

        // プログレス表示の更新
        const updateProgress = (message: string, progress: number) => {
            console.log(`Progress: ${progress}% - ${message}`);
            if (onProgress) {
                onProgress(message, progress);
            }
        };

        updateProgress('WebWorkerを初期化中...', 0);

        // WebWorker作成
        const worker = new Worker(new URL('./worker.ts', import.meta.url), {
            type: 'module',
        });

        // WebWorkerからのメッセージハンドラー
        worker.onmessage = (e) => {
            const { type, buffer, message, progress, error, stack } = e.data;

            switch (type) {
                case 'progress':
                    updateProgress(message, progress);
                    break;

                case 'complete':
                    updateProgress('ダウンロードを開始...', 95);

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

                        updateProgress('ダウンロード完了！', 100);
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

        // データ前処理とサイズチェック
        try {
            const height = demArray.length;
            const width = demArray[0]?.length || 0;
            const estimatedSizeMB = (width * height * 4) / (1024 * 1024);

            updateProgress(`データサイズ: ${estimatedSizeMB.toFixed(1)}MB`, 5);

            if (estimatedSizeMB > 500) {
                const proceed = confirm(`非常に大きなファイル (${estimatedSizeMB.toFixed(1)} MB) を作成しようとしています。\\n` + `処理に時間がかかる可能性があります。続行しますか？`);
                if (!proceed) {
                    worker.terminate();
                    resolve(false);
                    return;
                }
            }

            // WebWorkerにタスクを送信
            updateProgress('WebWorkerにデータを送信中...', 10);
            worker.postMessage({
                type: 'createTiff',
                demArray: demArray,
                geoTransform: geoTransform,
                includeGeoInfo: includeGeoInfo,
            });
        } catch (error) {
            console.error('❌ Data preprocessing error:', error);
            worker.terminate();
            reject(error);
        }
    });
};

// プログレス表示付きUI付きのラッパー関数
export const downloadTiffWithUI = async (demArray: number[][], geoTransform: number[], filename: string = 'elevation.tif', includeGeoInfo: boolean = true) => {
    // プログレス表示要素を作成
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        min-width: 300px;
        text-align: center;
        font-family: Arial, sans-serif;
    `;

    const messageElement = document.createElement('div');
    messageElement.style.marginBottom = '10px';
    messageElement.textContent = '準備中...';

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
        width: 100%;
        height: 20px;
        background: #f0f0f0;
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 10px;
    `;

    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
        height: 100%;
        background: linear-gradient(90deg, #4CAF50, #45a049);
        width: 0%;
        transition: width 0.3s ease;
    `;
    progressBar.appendChild(progressFill);

    const percentElement = document.createElement('div');
    percentElement.textContent = '0%';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'キャンセル';
    cancelButton.style.cssText = `
        padding: 8px 16px;
        margin-top: 10px;
        border: none;
        background: #f44336;
        color: white;
        border-radius: 4px;
        cursor: pointer;
    `;

    progressContainer.appendChild(messageElement);
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(percentElement);
    progressContainer.appendChild(cancelButton);
    document.body.appendChild(progressContainer);

    let cancelled = false;
    cancelButton.onclick = () => {
        cancelled = true;
        document.body.removeChild(progressContainer);
    };

    try {
        const success = await downloadGeoTiffWithWorker(demArray, geoTransform, filename, includeGeoInfo, (message, progress) => {
            if (cancelled) return;

            messageElement.textContent = message;
            progressFill.style.width = `${progress}%`;
            percentElement.textContent = `${progress.toFixed(0)}%`;
        });

        if (!cancelled) {
            document.body.removeChild(progressContainer);
        }

        return success;
    } catch (error) {
        if (!cancelled) {
            document.body.removeChild(progressContainer);
        }
        throw error;
    }
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
                    const dem = await createDemFromZipUpload(file);
                    console.log('DEM created successfully:', dem);

                    const geotiffData = await createGeoTiffFromDem(dem);

                    const { geoTransform, demArray, imageSize } = geotiffData;

                    // geotiffjsでgeotiffを作成

                    const elevationScale = 0.5; // 標高のスケールを調整するための係数

                    // 標高データを3Dメッシュに変換
                    const geometry = new THREE.PlaneGeometry(imageSize.x, imageSize.y, imageSize.x - 1, imageSize.y - 1);

                    // 標高データで頂点を変位
                    const vertices = geometry.attributes.position.array;
                    for (let i = 0; i < vertices.length; i += 3) {
                        const x = Math.floor(i / 3) % imageSize.x;
                        const y = Math.floor(i / 3 / imageSize.x);
                        const h = demArray[y][x] === -9999 ? 0 : demArray[y][x];
                        vertices[i + 2] = h * elevationScale; // Z座標に標高を適用
                    }

                    geometry.attributes.position.needsUpdate = true;
                    geometry.computeVertexNormals();
                    // マテリアルの作成
                    const material = new THREE.MeshBasicMaterial({
                        color: 0x00ff00,

                        wireframe: true,
                    });
                    // メッシュの作成
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.rotation.x = -Math.PI / 2; // 地面に対して水平に配置

                    scene.add(mesh);

                    console.log('DEM Mesh created successfully:', mesh);

                    // シンプルなプログレスコールバック版
                    await downloadTiffWithUI(
                        demArray,
                        geoTransform,
                        'elevation_simple.tif',
                        true, // 基本TIFF
                        (message, progress) => {
                            console.log(`${progress}%: ${message}`);
                        },
                    );

                    // ここで成功時の処理を行う
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

// ...existing code...
