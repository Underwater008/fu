// Particle fragment shader — samples character atlas, applies color tint
// Atlas: white chars with baked glow on BLACK background (R channel = intensity)
// Output: premultiplied alpha for additive blending

uniform sampler2D atlas;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
    float raw = texture2D(atlas, vUv).r;
    float intensity = pow(raw, 0.75); // Lift dim glow fringe for softer halo
    float alpha = intensity * vAlpha;
    if (alpha < 0.01) discard;

    // Premultiplied color for additive blending (src + dst)
    gl_FragColor = vec4(vColor * alpha, alpha);
}
