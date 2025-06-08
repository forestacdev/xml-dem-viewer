import vertexShaderSource from "./shaders/vertex.glsl?raw";
import fragmentShaderSource from "./shaders/fragment.glsl?raw";

import type { CanvasOptions } from "./index";

type MessageType = "init" | "add";

interface Props {
    data: {
        type: MessageType;
        canvas: HTMLCanvasElement;
    };
}

let canvas: HTMLCanvasElement; // オフスクリーンキャンバスまたはHTMLCanvasElement
let program: WebGLProgram | null = null;
let gl: WebGL2RenderingContext | null = null; // WebGL2に変更

// メインスレッドから通達があったとき
self.onmessage = (event) => {
    switch (event.data.type) {
        case "init":
            init(event);
            break;
        case "add":
            processCanvas(event.data.option);
            break;
    }
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
    canvas = event.data.canvas;
    if (!canvas) {
        throw new Error('Canvas element with id "my-canvas" not found.');
    }
    gl = canvas.getContext("webgl2");
    if (!gl) {
        throw new Error("WebGL context could not be initialized.");
    }

    // const ext = gl.getExtension("EXT_color_buffer_float");
    // if (!ext) {
    //     console.error("Float texture not supported");
    // }
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

    // texImage2Dで2Dテクスチャを設定
    gl.texImage2D(
        gl.TEXTURE_2D, // target
        0, // level
        gl.R32F, // internalFormat
        width, // width
        height, // height
        0, // border
        gl.RED,
        gl.FLOAT,
        array, // pixels
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    gl.uniform2f(resolutionLocation, width, height);

    // 追加：テクスチャサンプラーのユニフォームを設定
    const textureUniformLocation = gl.getUniformLocation(program, "u_texArray");
    gl.uniform1i(textureUniformLocation, 0); // TEXTURE0を使用

    const bboxUniformLocation = gl.getUniformLocation(program, "u_bbox_4326");
    gl.uniform4fv(bboxUniformLocation, bbox);

    const minUniformLocation = gl.getUniformLocation(program, "u_min");
    gl.uniform1f(minUniformLocation, min);
    const maxUniformLocation = gl.getUniformLocation(program, "u_max");
    gl.uniform1f(maxUniformLocation, max);

    const demTypeUniformLocation = gl.getUniformLocation(program, "u_dem_type");
    gl.uniform1i(demTypeUniformLocation, 0); // DEMタイプを0に設定（例: 標高）

    // WebGLで描画
    gl.drawArrays(gl.TRIANGLES, 0, 6);
};
