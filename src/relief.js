// Camera-space relief mesh. The reference camera projects every vertex back to its
// source texel, so the illustrated landscape and route share one coordinate system.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(n, hi));
function depth(u, v) {
  const valley = 0.84 - 0.67 * v;
  const ridge = Math.min(0.35, Math.abs(u - valley)) * Math.sin(Math.PI * v);
  return -0.55 + 1.04 * Math.pow(v, 1.5) + ridge * 0.8;
}

export function createRelief(canvas, image, onCamera) {
  let yaw = 0,
    pitch = 0,
    gl,
    program,
    count = 0;
  let viewport,
    camera,
    ready = false;
  function project(u, v) {
    const z = depth(u, v),
      x = 2 * u - 1,
      y = 1 - 2 * v;
    const scale = 1 + 0.49 * (Math.abs(yaw) + Math.abs(pitch));
    return [
      ((x * Math.cos(yaw) + z * Math.sin(yaw)) * scale + 1) / 2,
      (1 -
        (y * Math.cos(pitch) +
          (z * Math.cos(yaw) - x * Math.sin(yaw)) * Math.sin(pitch)) *
          scale) /
        2,
    ];
  }
  function render() {
    if (ready) {
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * ratio),
        h = Math.round(canvas.clientHeight * ratio);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(camera, yaw, pitch);
      gl.drawArrays(gl.TRIANGLES, 0, count);
    }
    onCamera(ready ? project : (x, y) => [x, y]);
  }
  function setCamera(x, y) {
    yaw = clamp(x, -0.32, 0.32);
    pitch = clamp(y, -0.19, 0.19);
    if (!ready) {
      // Flat image fallback retains route markers and allows panning with the image.
      canvas.parentElement.style.translate =
        yaw * 23 + "px " + pitch * 23 + "px";
    }
    render();
  }
  const shader = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
      throw Error("Terrain shader unavailable");
    return sh;
  };
  function init() {
    try {
      gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: true,
        powerPreference: "low-power",
      });
      if (!gl) return;
      program = gl.createProgram();
      gl.attachShader(
        program,
        shader(
          gl.VERTEX_SHADER,
          `
        attribute vec3 aPoint; uniform vec2 uCamera; varying vec2 uv;
        void main(){
          uv=aPoint.xy; vec2 xy=vec2(uv.x*2.-1.,1.-2.*uv.y);
          float a=uCamera.x,b=uCamera.y,z=aPoint.z;
          float x=xy.x*cos(a)+z*sin(a);
          float y=xy.y*cos(b)+(z*cos(a)-xy.x*sin(a))*sin(b);
          gl_Position=vec4(vec2(x,y)*(1.+.49*(abs(a)+abs(b))),0.,1.);
        }`,
        ),
      );
      gl.attachShader(
        program,
        shader(
          gl.FRAGMENT_SHADER,
          `
        precision mediump float; varying vec2 uv; uniform sampler2D terrain;
        void main(){gl_FragColor=texture2D(terrain,uv);}
      `,
        ),
      );
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
      gl.useProgram(program);
      const cols = 90,
        rows = 64,
        vertices = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          for (const [dx, dy] of [
            [0, 0],
            [0, 1],
            [1, 0],
            [0, 1],
            [1, 1],
            [1, 0],
          ]) {
            const u = (i + dx) / cols,
              v = (j + dy) / rows;
            vertices.push(u, v, depth(u, v));
          }
        }
      count = vertices.length / 3;
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertices),
        gl.STATIC_DRAW,
      );
      const pos = gl.getAttribLocation(program, "aPoint");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);
      camera = gl.getUniformLocation(program, "uCamera");
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      for (const dir of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
        gl.texParameteri(gl.TEXTURE_2D, dir, gl.CLAMP_TO_EDGE);
      for (const filter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER])
        gl.texParameteri(gl.TEXTURE_2D, filter, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
      ready = true;
      render();
      canvas.classList.add("ready");
      viewport = new ResizeObserver(render);
      viewport.observe(canvas);
    } catch {
      ready = false;
      canvas.classList.remove("ready");
    }
  }
  if (image.complete && image.naturalWidth) init();
  else image.addEventListener("load", init, { once: true });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    ready = false;
    canvas.classList.remove("ready");
    render();
    viewport?.disconnect();
  });
  canvas.addEventListener("webglcontextrestored", init);
  return { setCamera, getCamera: () => [yaw, pitch] };
}
