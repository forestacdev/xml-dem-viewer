precision highp float;

out vec2 v_uv;// fragmentShaderに渡すためのvarying変数
out vec3 v_position;
uniform float uTime;
out vec3 v_normal;
out mat4 v_model_matrix;

void main() {
    v_uv = uv;
    v_position = position;
    v_normal = normal;
    v_model_matrix = modelMatrix;
    // ワールド座標を計算
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}