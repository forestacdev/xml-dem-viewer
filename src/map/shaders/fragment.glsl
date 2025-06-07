#version 300 es
precision highp float;

uniform sampler2D u_texArray;

uniform float u_min;
uniform float u_max;


in vec2 v_tex_coord ;
out vec4 fragColor;



void main() {
    vec2 uv = v_tex_coord;
	float value = texture(u_texArray, uv).r;

    if(value == -9999.0) {
        // -9999 の場合は透明にする
        fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
    }

	float normalized = clamp((value - u_min) / (u_max - u_min), 0.0, 1.0);
    
    // グレースケールで出力
    
    vec4 value_color = vec4(normalized, normalized, normalized, 1.0);


    fragColor = value_color; // グレースケールで出力

}