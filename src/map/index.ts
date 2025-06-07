import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Coordinates } from 'maplibre-gl';

import vertexShaderSource from './shaders/vertex.glsl?raw';
import fragmentShaderSource from './shaders/fragment.glsl?raw';

import type { ImageSize, GeoTransform, GeoTiffData } from '../geotiff';

interface CanvasOptions {
    array: Float32Array;
    bbox: [number, number, number, number];
    min: number;
    max: number;
    height: number;
    width: number;
}

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

const processCanvas = (option: CanvasOptions) => {
    if (!gl || !program) return;

    const { array, bbox, height, width, min, max } = option;

    // キャンバスサイズを合わせる
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, canvas.width, canvas.height);

    // テクスチャを作成し既存キャンバスを読み込む
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    // texImage2Dで2Dテクスチャを設定
    gl.texImage2D(
        gl.TEXTURE_2D, // target
        0, // level
        gl.R32F,
        width, // width
        height, // height
        0, // border
        gl.RED,
        gl.FLOAT,
        array, // pixels
    );

    // テクスチャパラメータを設定
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // バインドを解除
    gl.bindTexture(gl.TEXTURE_2D, null);

    const bboxUniformLocation = gl.getUniformLocation(program, 'u_bbox_4326');
    gl.uniform4fv(bboxUniformLocation, bbox);

    const minUniformLocation = gl.getUniformLocation(program, 'u_min');
    gl.uniform1f(minUniformLocation, min);
    const maxUniformLocation = gl.getUniformLocation(program, 'u_max');
    gl.uniform1f(maxUniformLocation, max);

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
const processImage = async (option: CanvasOptions) => {
    const { height, width } = option;

    // WebGL処理
    processCanvas(option);

    // キャンバスサイズ更新
    canvas.width = width;
    canvas.height = height;

    // return { dataCanvas, coordinates };
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
    zoom: 4,
});

export const addMapLayerFromDem = async (geotiffData: GeoTiffData) => {
    if (!mapLibreMap) {
        throw new Error('MapLibre map instance is not initialized.');
    }

    const { geoTransform, demArray, imageSize, statistics } = geotiffData;

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

    const min = statistics.minElevation;
    const max = statistics.maxElevation;
    const bbox = [
        statistics.bounds.lower_left.lon, // minX (west)
        statistics.bounds.lower_left.lat, // minY (south)
        statistics.bounds.upper_right.lon, // maxX (east)
        statistics.bounds.upper_right.lat,
    ] as [number, number, number, number];

    const option: CanvasOptions = {
        array: elevationArray,
        bbox,
        min,
        max,
        height,
        width,
    };

    await processCanvas(option);

    // ソース追加
    mapLibreMap.addSource('canvas-source', {
        type: 'canvas',
        canvas: canvas,
        coordinates: [
            [bbox[0], bbox[3]], // upper left
            [bbox[2], bbox[3]], // upper right
            [bbox[2], bbox[1]], // lower right
            [bbox[0], bbox[1]], // lower left
        ],
        animate: true,
    });
    // レイヤー追加
    mapLibreMap.addLayer({
        id: 'canvas-layer',
        type: 'raster',
        source: 'canvas-source',
    });

    mapLibreMap.fitBounds(bbox, {
        padding: { top: 50, bottom: 50, left: 50, right: 50 },
        duration: 1500,
    });
};
