import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let orbitControls: OrbitControls;

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

const init = (event) => {
    // メインスレッドからオフスクリーンキャンバスを受け取る
    const canvas = event.data.canvas;
    // スクリーン情報を受け取る
    const width = event.data.width;
    const height = event.data.height;
    const devicePixelRatio = event.data.devicePixelRatio;
    // Three.jsのライブラリの内部で style.width にアクセスされてしまう
    // 対策しないと、エラーが発生するためダミーの値を指定
    canvas.style = { width: 0, height: 0 };

    // レンダラーを作成
    renderer = new THREE.WebGLRenderer({ canvas });

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    camera.position.set(0, 0, 1000);
    // OrbitControlsを初期化（ダミーDOM要素を作成）
    const dummyDomElement = createDummyDomElement(width, height);
    orbitControls = new OrbitControls(camera, dummyDomElement);
    orbitControls.enableDamping = true;
    orbitControls.enablePan = false;

    resize(width, height, devicePixelRatio);

    // 球体を作成
    const geometry = new THREE.SphereGeometry(300, 30, 30);
    // マテリアルを作成
    const material = new THREE.MeshBasicMaterial({ wireframe: true });
    // メッシュを作成
    const mesh = new THREE.Mesh(geometry, material);
    // 3D空間にメッシュを追加
    scene.add(mesh);

    tick();

    // 毎フレーム時に実行されるループイベントです
    function tick() {
        mesh.rotation.y += 0.01;

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
        console.log('mousemove', clientX, clientY, buttons);
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

    // DEMデータを元にメッシュを作成
    const geometry = new THREE.PlaneGeometry(
        imageSize.x,
        imageSize.y,
        Math.min(imageSize.x - 1, 512), // 頂点数を制限
        Math.min(imageSize.y - 1, 512),
    );

    const vertices = geometry.attributes.position.array;
    const elevationScale = 0.5;

    // 頂点の標高を設定
    for (let i = 0; i < vertices.length; i += 3) {
        const vertexIndex = i / 3;
        const x = Math.floor(vertexIndex % (geometry.parameters.widthSegments + 1));
        const y = Math.floor(vertexIndex / (geometry.parameters.widthSegments + 1));

        // DEMデータのサンプリング
        const demX = Math.floor((x / geometry.parameters.widthSegments) * (imageSize.x - 1));
        const demY = Math.floor((y / geometry.parameters.heightSegments) * (imageSize.y - 1));

        if (demY < demArray.length && demX < demArray[demY].length) {
            const elevation = demArray[demY][demX] === -9999 ? 0 : demArray[demY][demX];
            (vertices as Float32Array)[i + 2] = elevation * elevationScale;
        }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true });

    // メッシュを作成
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'demMesh';
    mesh.rotation.x = -Math.PI / 2;

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
