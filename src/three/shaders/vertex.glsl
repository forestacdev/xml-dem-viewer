precision highp float;

out vec2 v_uv;// fragmentShaderに渡すためのvarying変数
out vec3 v_position;

uniform float u_scale;
out vec3 v_normal;
out mat4 v_model_matrix;

void main() {
    v_uv = uv;
    
    // positionをコピーしてY軸（高さ）をスケール
    vec3 scaledPosition = position;
    scaledPosition.y *= u_scale;
    
    v_position = scaledPosition;
    v_normal = normal;
    v_model_matrix = modelMatrix;
    
    // ワールド座標を計算（スケール済みの位置を使用）
    vec4 worldPosition = modelMatrix * vec4(scaledPosition, 1.0);

    // 最終的な位置計算でもスケール済みの位置を使用
    gl_Position = projectionMatrix * modelViewMatrix * vec4(scaledPosition, 1.0);
}