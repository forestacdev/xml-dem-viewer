import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { ImageSize, GeoTransform } from '../geotiff';
import { generateDemMesh } from './mesh';

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let orbitControls: OrbitControls;

type MessageType = 'init' | 'addMesh' | 'resize' | 'mouseEvent' | 'wheelEvent' | 'toggleView';

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
        isView: boolean;
    };
}

export const uniforms = {
    uColor: { value: new THREE.Color('rgb(255,255,255)') },
};

// メインスレッドから通達があったとき
self.onmessage = (event) => {
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
        case 'toggleView':
            toggleCanvasView(event.data.mode);
            break;
    }
};

const toggleCanvasView = (val: boolean) => {
    // canvasの表示/非表示を切り替える
    const canvas = (self as any).canvas; // ワーカー内でcanvasを参照
    if (val) {
        canvas.style.display = 'block'; // 3Dビューに切り替え
    } else {
        canvas.style.display = 'none'; // マップビューに切り替え
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

    // 毎フレーム時に実行されるループイベントです
    const tick = () => {
        const target = orbitControls.target;

        // レンダリング
        if (orbitControls) orbitControls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
    };
    tick();
};

// ダミーDOM要素を作成してイベントハンドリングを可能にする
const createDummyDomElement = (width: number, height: number) => {
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
};

// マウスイベントを処理
const handleMouseEvent = (eventData: any) => {
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
};

// ホイールイベントを処理
const handleWheelEvent = (eventData: any) => {
    const { deltaY } = eventData;

    // @ts-ignore
    orbitControls._onMouseWheel({
        deltaY,
        preventDefault: () => {},
        stopPropagation: () => {},
    });
};

const addMesh = (demArray: number[][], geoTransform: GeoTransform, imageSize: ImageSize) => {
    // 既存のメッシュをクリア
    const existingMesh = scene.getObjectByName('demMesh');
    if (existingMesh) {
        scene.remove(existingMesh);
        (existingMesh as THREE.Mesh).geometry.dispose();
        ((existingMesh as THREE.Mesh).material as THREE.Material).dispose();
    }

    const demMesh = generateDemMesh(demArray, geoTransform, imageSize);

    scene.add(demMesh);

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
