import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import fragmentShader from '../shaders/fragment.glsl?raw';
import vertexShader from '../shaders/vertex.glsl?raw';
let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let orbitControls: OrbitControls;

type MessageType = 'init' | 'addMesh' | 'resize' | 'mouseEvent' | 'wheelEvent';

type MouseEventType = 'mousedown' | 'mousemove' | 'mouseup' | 'wheel';

interface Props {
    data: {
        type: MessageType;
        canvas: HTMLCanvasElement;
        width: number;
        height: number;
        devicePixelRatio: number;
        clientX: number;
        clientY: number;
        button: number;
        buttons: number;
        eventType: MouseEventType; // 'mousedown', 'mousemove', 'mouseup' など
        demArray: number[][];
        geoTransform: number[];
        imageSize: { x: number; y: number };
    };
}

const demMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uColor: { value: new THREE.Color('rgb(255,255,255)') },
    },
    // 頂点シェーダー
    vertexShader,
    fragmentShader,
    transparent: true,
});

// メインスレッドから通達があったとき
onmessage = (event) => {
    switch (event.data.type) {
        case 'init':
            init(event);
            break;
        case 'addMesh':
            addMesh(event.data.demArray, event.data.geoTransform, event.data.imageSize);
            break;
        case 'resize':
            resize(event.data.width, event.data.height, event.data.devicePixelRatio);
            break;
        case 'mouseEvent':
            handleMouseEvent(event.data);
            break;
        case 'wheelEvent':
            handleWheelEvent(event.data);
            break;
    }
};

const init = (event: Props) => {
    // メインスレッドからオフスクリーンキャンバスを受け取る
    const canvas = event.data.canvas;
    // スクリーン情報を受け取る
    const width = event.data.width;
    const height = event.data.height;
    const devicePixelRatio = event.data.devicePixelRatio;
    // Three.jsのライブラリの内部で style.width にアクセスされてしまう
    // 対策しないと、エラーが発生するためダミーの値を指定
    canvas.style = {
        width: '0px',
        height: '0px',
    } as any;

    // レンダラーを作成
    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
    });

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.position.set(100, 100, 1000);
    // OrbitControlsを初期化（ダミーDOM要素を作成）
    const dummyDomElement = createDummyDomElement(width, height);
    orbitControls = new OrbitControls(camera, dummyDomElement);
    orbitControls.enableDamping = true;
    orbitControls.enablePan = false;

    const grid = new THREE.GridHelper(1000, 100, 0x0000ff, 0x808080);
    grid.name = 'grid';
    scene.add(grid);

    resize(width, height, devicePixelRatio);

    tick();

    // 毎フレーム時に実行されるループイベントです
    function tick() {
        const target = orbitControls.target;

        // レンダリング
        if (orbitControls) orbitControls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
    }
};

// ダミーDOM要素を作成してイベントハンドリングを可能にする

function createDummyDomElement(width: number, height: number) {
    const dummyDocument = {
        pointerLockElement: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        createElement: () => ({}),
        body: {},
        exitPointerLock: () => {},
    };

    const dummyElement = {
        // 基本的なプロパティ
        clientWidth: width,
        clientHeight: height,
        offsetWidth: width,
        offsetHeight: height,

        // DOM メソッド
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {},
        appendChild: () => {},
        removeChild: () => {},

        // getBoundingClientRect
        getBoundingClientRect: () => ({
            left: 0,
            top: 0,
            width: width,
            height: height,
            right: width,
            bottom: height,
            x: 0,
            y: 0,
        }),

        // getRootNode
        getRootNode: () => dummyDocument,

        // ポインター関連のメソッド（重要！）
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        hasPointerCapture: () => false,
        requestPointerLock: () => {},

        // その他のプロパティ
        style: {
            cursor: '',
            touchAction: '',
            userSelect: '',
            webkitUserSelect: '',
            mozUserSelect: '',
            msUserSelect: '',
        },
        className: '',
        id: '',
        tagName: 'DIV',
        nodeName: 'DIV',
        nodeType: 1,

        // 親要素関連
        parentNode: null,
        parentElement: null,
        children: [],
        childNodes: [],

        // イベント関連
        onclick: null,
        onmousedown: null,
        onmousemove: null,
        onmouseup: null,
        onwheel: null,
        onpointerdown: null,
        onpointermove: null,
        onpointerup: null,
        onpointercancel: null,
        oncontextmenu: null,

        // ownerDocument
        ownerDocument: dummyDocument,

        // フォーカス関連
        focus: () => {},
        blur: () => {},

        // その他のメソッド
        querySelector: () => null,
        querySelectorAll: () => [],
        contains: () => false,

        // 属性関連
        getAttribute: () => null,
        setAttribute: () => {},
        removeAttribute: () => {},
        hasAttribute: () => false,

        // クラス関連
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false,
            toggle: () => false,
        },

        // データセット
        dataset: {},

        // スクロール関連
        scrollTop: 0,
        scrollLeft: 0,
        scrollWidth: width,
        scrollHeight: height,

        // クライアント関連
        clientTop: 0,
        clientLeft: 0,
    };

    return dummyElement;
}

// マウスイベントを処理
function handleMouseEvent(eventData: any) {
    const { type, clientX, clientY, button, buttons, eventType } = eventData;

    // OrbitControlsの内部状態を直接操作
    if (eventType === 'mousedown') {
        orbitControls.enabled = true;
        // @ts-ignore - 内部プロパティにアクセス
        orbitControls._onPointerDown({
            clientX,
            clientY,
            button,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
    } else if (eventType === 'mousemove') {
        // @ts-ignore
        orbitControls._onPointerMove({
            clientX,
            clientY,
            preventDefault: () => {},
            stopPropagation: () => {},
        });
    } else if (eventType === 'mouseup') {
        // @ts-ignore
        orbitControls._onPointerUp({
            preventDefault: () => {},
            stopPropagation: () => {},
        });
    }
}

// ホイールイベントを処理
function handleWheelEvent(eventData: any) {
    const { deltaY } = eventData;

    // @ts-ignore
    orbitControls._onMouseWheel({
        deltaY,
        preventDefault: () => {},
        stopPropagation: () => {},
    });
}

const addMesh = (demArray: number[][], geoTransform: number[], imageSize: { x: number; y: number }) => {
    // 既存のメッシュをクリア
    const existingMesh = scene.getObjectByName('demMesh');
    if (existingMesh) {
        scene.remove(existingMesh);
        (existingMesh as THREE.Mesh).geometry.dispose();
        ((existingMesh as THREE.Mesh).material as THREE.Material).dispose();
    }

    // DEMデータのサイズを取得
    const height = demArray.length;
    const width = demArray[0]?.length || 0;

    if (width === 0 || height === 0) {
        console.error('Invalid DEM data dimensions');
        return;
    }

    console.log(`📊 Creating BufferGeometry: ${width} × ${height} vertices`);

    // ピクセル解像度（スケール調整）
    const dx = imageSize.x / width;
    const dy = imageSize.y / height;
    const elevationScale = 0.5;

    // BufferGeometry作成
    const geometry = new THREE.BufferGeometry();

    // ラスターの中心座標を原点にするためのオフセット
    const xOffset = (width * dx) / 2;
    const zOffset = (height * dy) / 2;

    // 頂点座標の計算
    const vertices = new Float32Array(width * height * 3);
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const index = i * width + j;
            const x = j * dx - xOffset;
            const elevation = demArray[i][j] === -9999 ? 0 : demArray[i][j];
            const y = elevation * elevationScale;
            const z = i * dy - zOffset;
            const k = index * 3;
            vertices[k] = x;
            vertices[k + 1] = y;
            vertices[k + 2] = z;
        }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    // UV座標の計算とセット（テクスチャマッピング用）
    const uvs = new Float32Array(width * height * 2);
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            const index = i * width + j;
            const u = j / (width - 1);
            const v = i / (height - 1);
            const k = index * 2;
            uvs[k] = u;
            uvs[k + 1] = v;
        }
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    // インデックス配列の作成（三角形を定義）
    const quadCount = (width - 1) * (height - 1);
    const indices = new Uint32Array(quadCount * 6);
    let p = 0;
    for (let i = 0; i < height - 1; i++) {
        for (let j = 0; j < width - 1; j++) {
            const a = i * width + j;
            const b = a + width;
            const c = a + 1;
            const d = b + 1;

            // 三角形1: a, b, c
            indices[p++] = a;
            indices[p++] = b;
            indices[p++] = c;

            // 三角形2: b, d, c
            indices[p++] = b;
            indices[p++] = d;
            indices[p++] = c;
        }
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // 法線ベクトルを計算（陰影効果のため）
    geometry.computeVertexNormals();

    // メッシュを作成
    const mesh = new THREE.Mesh(geometry, demMaterial);
    mesh.name = 'demMesh';

    scene.add(mesh);

    // カメラ位置を調整
    camera.position.set(imageSize.x * 0.5, imageSize.y * 0.5, Math.max(imageSize.x, imageSize.y));
    orbitControls.target.set(0, 0, 0);
    orbitControls.update();
};

const resize = (width: number, height: number, devicePixelRatio: number) => {
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // ダミー要素のサイズも更新
    if (orbitControls && (orbitControls as any).domElement) {
        (orbitControls as any).domElement.clientWidth = width;
        (orbitControls as any).domElement.clientHeight = height;
    }
};
