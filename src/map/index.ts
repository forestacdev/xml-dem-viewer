import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Coordinates } from 'maplibre-gl';

import type { ImageSize, GeoTransform } from '../geotiff';

// 頂点シェーダー
const vertexShaderSource = /* GLSL */ `#version 300 es
    in vec4 a_position;
    out vec2 v_tex_coord;

    void main() {
        gl_Position = a_position;
        v_tex_coord = vec2(a_position.x * 0.5 + 0.5, a_position.y * -0.5 + 0.5); // Y軸を反転
    }
`;

// フラグメントシェーダー;
const fragmentShaderSource = /* GLSL */ `#version 300 es
    precision highp float;

    uniform sampler2D u_source;  // 既存キャンバスのテクスチャ
    uniform vec4 u_bbox_4326; // [minLng, minLat, maxLng, maxLat]

    in vec2 v_tex_coord;
    out vec4 fragColor;

    float R = 6378137.0; // メルカトル投影の地球半径

    // 経度→メルカトルX
    float lngToX(float lng) {
        return radians(lng) * R;
    }

    // 緯度→メルカトルY
    float latToY(float lat) {
        return R * log(tan(radians(lat) * 0.5 + 3.14159265 / 4.0));
    }

    // メルカトルY→緯度（逆変換）
    float yToLat(float y) {
        return degrees(2.0 * atan(exp(y / R)) - 3.14159265 / 2.0);
    }

    void main() {
        vec2 uv = v_tex_coord;

        // 表示側（メルカトル）Y
        float maxY = latToY(u_bbox_4326.w);
        float minY = latToY(u_bbox_4326.y);
        float y = mix(maxY, minY, uv.y); // メルカトルY座標

        // 表示側（メルカトル）X → 経度
        float lng = mix(u_bbox_4326.x, u_bbox_4326.z, uv.x);
        float lat = yToLat(y);

        // 緯度・経度 → UVに再マッピング
        float u = (lng - u_bbox_4326.x) / (u_bbox_4326.z - u_bbox_4326.x);
        float v = (u_bbox_4326.w - lat) / (u_bbox_4326.w - u_bbox_4326.y);

        vec2 src_uv = vec2(u, v);

        fragColor = texture(u_source, src_uv);
    }
`;

// シェーダー作成ヘルパー関数
const createShader = (gl: WebGLRenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type);

    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
};

// プログラム作成ヘルパー関数
const createProgram = (gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) => {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
        console.error(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
};

// キャンバスとWebGLコンテキストの初期化
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
canvas.style.display = 'none'; // 非表示にする

if (!canvas) {
    throw new Error('Canvas element with id "my-canvas" not found.');
}
const gl = canvas.getContext('webgl2');
if (!gl) {
    throw new Error('WebGL context could not be initialized.');
}
// シェーダープログラムの作成
const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

if (!vertexShader || !fragmentShader) {
    throw new Error('Failed to create shaders.');
}
const program = createProgram(gl, vertexShader, fragmentShader);
if (!program) {
    throw new Error('Failed to create WebGL program.');
}

// プログラムを使用
gl.useProgram(program);

// 頂点属性の設定
const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(positionAttributeLocation);
gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

interface Options {
    bbox: number[];
    colorMap: {
        min: number;
        max: number;
        colors: string;
    };
    width: number;
    height: number;
}

const processCanvas = (existingCanvas: HTMLCanvasElement, bbox: [number, number, number, number]) => {
    if (!gl || !program) return;

    // キャンバスサイズを合わせる
    canvas.width = existingCanvas.width;
    canvas.height = existingCanvas.height;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // テクスチャを作成し既存キャンバスを読み込む
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // 既存キャンバスの内容をテクスチャとして設定
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, existingCanvas);

    // テクスチャパラメータの設定
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // シェーダーに関連するユニフォーム変数を設定
    const sourceUniformLocation = gl.getUniformLocation(program, 'u_source');
    gl.uniform1i(sourceUniformLocation, 0); // テクスチャユニット0を使用
    const bboxUniformLocation = gl.getUniformLocation(program, 'u_bbox_4326');
    gl.uniform4fv(bboxUniformLocation, bbox);

    // WebGLで描画
    gl.drawArrays(gl.TRIANGLES, 0, 6);
};

const getMapBounds = (map: maplibregl.Map) => {
    const bbox = map.getBounds();
    const boxArray = [bbox._sw.lng, bbox._sw.lat, bbox._ne.lng, bbox._ne.lat] as [number, number, number, number];
    const coordinates: Coordinates = [
        [bbox._sw.lng, bbox._ne.lat],
        [bbox._ne.lng, bbox._ne.lat],
        [bbox._ne.lng, bbox._sw.lat],
        [bbox._sw.lng, bbox._sw.lat],
    ];

    return {
        bbox,
        boxArray,
        coordinates,
    };
};

// 画像データ取得と処理の共通化
const processImage = async (map: maplibregl.Map) => {
    const mapCanvas = map.getCanvas();
    const { boxArray, coordinates } = getMapBounds(map);

    // データ取得
    const dataCanvas = await getCanvas({
        colorMap: {
            min: 0,
            max: 6000,
            colors: 'jet',
        },
        width: mapCanvas.width,
        height: mapCanvas.height,
        bbox: boxArray,
    });

    // WebGL処理
    processCanvas(dataCanvas, boxArray);

    // キャンバスサイズ更新
    canvas.width = mapCanvas.width;
    canvas.height = mapCanvas.height;

    return { dataCanvas, coordinates };
};

// 地図インスタンスの初期化
export const mapLibreMap = new maplibregl.Map({
    container: 'map',
    style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                minzoom: 0,
                maxzoom: 19,
                attribution: '&copy; OpenStreetMap contributors',
            },
        },
        layers: [
            {
                id: 'osm',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 22,
            },
        ],
    },
    center: [139.477, 35.681],
    zoom: 2,
});

export const addMapLayerFromDem = async (demArray: number[][], geoTransform: GeoTransform, imageSize: ImageSize) => {
    if (!mapLibreMap) {
        throw new Error('MapLibre map instance is not initialized.');
    }

    console.log('Adding DEM layer to MapLibre map...');
    console.log('Adding DEM layer to MapLibre map...');
    console.log('Adding DEM layer to MapLibre map...');
    console.log('Adding DEM layer to MapLibre map...');

    const height = demArray.length;
    const width = demArray[0]?.length || 0;
    // 1次元配列に変換
    const elevationArray = new Float32Array(width * height);
    let index = 0;

    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            let elevation = demArray[i][j];
            // NoData値の処理
            // if (elevation === -9999 || isNaN(elevation)) {
            //     elevation = statistics.minElevation;
            // }
            elevationArray[index] = elevation;
            index++;
        }
    }
};

mapLibreMap.on('load', async () => {
    // const { coordinates } = getMapBounds(map);
    // // ソース追加
    // map.addSource('canvas-source', {
    //     type: 'canvas',
    //     canvas: canvas,
    //     coordinates: coordinates,
    // });
    // // レイヤー追加
    // map.addLayer({
    //     id: 'canvas-layer',
    //     type: 'raster',
    //     source: 'canvas-source',
    // });
    // // 初期データ読み込みと処理
    // await processImage(map);
    // // 地図の移動イベントリスナーを設定
    // // 地図が移動した後に画像を再取得してキャンバスを更新
    // map.on('moveend', async () => {
    //     const { coordinates } = await processImage(map);
    //     // 座標の更新
    //     const canvasSource = map.getSource('canvas-source') as maplibregl.CanvasSource;
    //     canvasSource.setCoordinates(coordinates);
    // });
});
