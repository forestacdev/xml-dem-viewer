import vertexShaderSource from "./shaders/vertex.glsl?raw";
import fragmentShaderSource from "./shaders/fragment.glsl?raw";

import type { CanvasOptions } from "./index";
import { uniforms } from "./uniforms";
import type { UniformValues, Color } from "./uniforms";

type MessageType = "init" | "add";

interface Props {
    data: {
        type: MessageType;
        canvas?: HTMLCanvasElement;
    };
}
// Uniformsの型定義

let canvas: HTMLCanvasElement;
let program: WebGLProgram | null = null;
let gl: WebGL2RenderingContext | null = null;
let uniformLocations: Map<string, WebGLUniformLocation | null> = new Map();
let animationId: number | null = null;
let startTime = 0;

// メインスレッドから通達があったとき
self.onmessage = (event) => {
    switch (event.data.type) {
        case "init":
            init(event);
            break;
        case "add":
            processCanvas(event.data.option);
            break;
        case "updateUniforms":
            applyUniforms(event.data.key, event.data.value);
            break;
        default:
            console.warn(`Unknown message type: ${event.data.type}`);
            break;
    }
};

// Uniform locationを初期化
const initializeUniformLocations = () => {
    if (!gl || !program) return;

    const uniformNames = [
        "u_resolution",
        "u_bbox_4326",
        "u_min",
        "u_max",
        "u_max_color",
        "u_min_color",
        "u_dem_type",
        "u_time",
        "u_scale",
        "u_texArray",
    ];

    uniformNames.forEach((name) => {
        const location = gl!.getUniformLocation(program!, name);
        uniformLocations.set(name, location);
    });
};

const convertColorToArray = (color: Color): [number, number, number] => {
    return [color.r, color.g, color.b];
};

// Uniformsを適用
const applyUniforms = (key?: keyof UniformValues, value?: any) => {
    if (!gl) return;
    if (key && value !== undefined) {
        // 特定のキーの値を更新
        uniforms[key] = value;
    }

    // u_resolution
    const resLoc = uniformLocations.get("u_resolution");
    if (resLoc) gl.uniform2fv(resLoc, uniforms.u_resolution);

    // u_bbox_4326
    const bboxLoc = uniformLocations.get("u_bbox_4326");
    if (bboxLoc) gl.uniform4fv(bboxLoc, uniforms.u_bbox_4326);

    // u_min
    const minLoc = uniformLocations.get("u_min");
    if (minLoc) gl.uniform1f(minLoc, uniforms.u_min);

    // u_max
    const maxLoc = uniformLocations.get("u_max");
    if (maxLoc) gl.uniform1f(maxLoc, uniforms.u_max);

    // u_max_color
    const maxColorLoc = uniformLocations.get("u_max_color");
    if (maxColorLoc) gl.uniform3fv(maxColorLoc, convertColorToArray(uniforms.u_max_color));
    // u_min_color
    const minColorLoc = uniformLocations.get("u_min_color");
    if (minColorLoc) gl.uniform3fv(minColorLoc, convertColorToArray(uniforms.u_min_color));

    // u_dem_type
    const typeLoc = uniformLocations.get("u_dem_type");
    if (typeLoc) gl.uniform1i(typeLoc, uniforms.u_dem_type);

    // u_time
    const timeLoc = uniformLocations.get("u_time");
    if (timeLoc) gl.uniform1f(timeLoc, uniforms.u_time);

    // u_scale
    const scaleLoc = uniformLocations.get("u_scale");
    if (scaleLoc) gl.uniform1f(scaleLoc, uniforms.u_scale);

    // テクスチャサンプラー
    const texLoc = uniformLocations.get("u_texArray");
    if (texLoc) gl.uniform1i(texLoc, 0);
};

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
const createProgram = (
    gl: WebGLRenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader,
) => {
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

const init = (event: Props) => {
    canvas = event.data.canvas!;
    if (!canvas) {
        throw new Error("Canvas element not found.");
    }

    gl = canvas.getContext("webgl2");
    if (!gl) {
        throw new Error("WebGL context could not be initialized.");
    }

    // シェーダープログラムの作成
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) {
        throw new Error("Failed to create shaders.");
    }

    program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) {
        throw new Error("Failed to create WebGL program.");
    }

    // Uniform locationsを初期化
    initializeUniformLocations();

    // プログラムを使用
    gl.useProgram(program);

    // 頂点属性の設定
    const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]),
        gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // アニメーションループを開始
    startAnimationLoop();
};

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

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, array);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Uniformsを更新
    uniforms.u_resolution = [width, height];
    uniforms.u_bbox_4326 = bbox;
    uniforms.u_min = min;
    uniforms.u_max = max;
    uniforms.u_dem_type = 0;
    applyUniforms();

    self.postMessage({ type: "update", uniforms: uniforms });
};

// レンダリング関数
const render = () => {
    if (!gl) return;

    // Uniformsを適用
    applyUniforms();

    // 描画
    gl.drawArrays(gl.TRIANGLES, 0, 6);
};

// アニメーションループ
const startAnimationLoop = () => {
    startTime = Date.now();

    const tick = () => {
        // 時間を更新
        uniforms.u_time = (Date.now() - startTime) / 1000;

        render();
        animationId = requestAnimationFrame(tick);
    };

    tick();
};

// アニメーションを停止
export const stopAnimationLoop = () => {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
};
