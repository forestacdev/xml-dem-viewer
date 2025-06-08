precision highp float;

in vec3 v_position;
in vec3 v_normal;
in vec2 v_uv;
in mat4 v_model_matrix;

uniform vec3 u_color;

out vec4 fragColor;

void main(){
    // ライトの方向（上から斜めに当たる）
    vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.3));
    
    // 基本的なランバート拡散光
    float NdotL = max(dot(normalize(v_normal), lightDirection), 0.0);
    
    // 環境光
    float ambient = 0.3;
    
    // 全体の明度
    float lighting = ambient + NdotL * 0.7;
    
    // 基本色に陰影を適用
    vec3 baseColor = u_color;
    vec3 shadedColor = baseColor * lighting;
    
    fragColor = vec4(shadedColor, 1.0);
}