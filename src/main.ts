import './style.css';

import { createDemFromZipUpload } from './demxml';
import { createGeoTiffFromDem } from './geotiff';

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import GeoTIFF, { writeArrayBuffer } from 'geotiff';

// シーンの作成
const scene = new THREE.Scene();

// カメラ
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);

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
                    const dem = await createDemFromZipUpload(file);
                    console.log('DEM created successfully:', dem);

                    const geotiffData = await createGeoTiffFromDem(dem);

                    const { geoTransform, demArray, imageSize } = geotiffData;

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

                    // GeoTIFFダウンロード
                    await downloadGeoTiffWithWorker(demArray, geoTransform, 'elevation.tif');
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
