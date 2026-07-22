/** Vertex shader — flips Y for WebGL coordinate system */
export const vertSrc =
  "attribute vec2 a_pos; varying vec2 v_uv; void main(){" +
  "v_uv=a_pos*0.5+0.5; v_uv.y=1.0-v_uv.y; gl_Position=vec4(a_pos,0,1);}";

/** Shared uniform header — every fragment shader starts with this */
export const H =
  "precision mediump float;" +
  "varying vec2 v_uv;" +
  "uniform sampler2D u_from, u_to;" +
  "uniform float u_progress;" +
  "uniform vec2 u_resolution;" +
  "uniform vec3 u_accent;" +
  "uniform vec3 u_accent_dark;" +
  "uniform vec3 u_accent_bright;\n";

/** Quintic C2 noise + inter-octave rotation FBM */
export const NQ =
  "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}" +
  "float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);" +
  "f=f*f*f*(f*(f*6.-15.)+10.);" +
  "return mix(mix(hash(i),hash(i+vec2(1,0)),f.x)," +
  "mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}" +
  "float fbm(vec2 p){float v=0.,a=.5;" +
  "mat2 R=mat2(.8,.6,-.6,.8);" +
  "for(int i=0;i<5;i++){v+=a*vnoise(p);p=R*p*2.02;a*=.5;}return v;}";
