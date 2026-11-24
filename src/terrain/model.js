import { PlaneGeometry, Vector3 } from 'three';
import { gunzipSync } from 'three/addons/libs/fflate.module.js';
import packedUrl from './heights.gz?inline';
import grid from './grid.json';
import route from './route.json';

const last = grid.segments.at(-1);
const size = last + 1;
const origin = [83.862, 28.47];
const kmPerDegree = [111.195 * Math.cos(origin[1] * Math.PI / 180), 111.195];
let heights;

function survey() {
  if (heights) return heights;
  const bytes = Uint8Array.from(atob(packedUrl.slice(packedUrl.indexOf(',') + 1)), c => c.charCodeAt(0));
  const unpacked = gunzipSync(bytes);
  const encoded = new DataView(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength);
  heights = new Uint16Array(size * size);
  for (let row = 0; row < size; row++) {
    let height = 0;
    for (let col = 0; col < size; col++) {
      const i = row * size + col;
      height += encoded.getInt16(i * 2, true);
      heights[i] = height;
    }
  }
  return heights;
}

function interpolate(value, from, to) {
  const ordered = from[0] < from[3];
  const between = i => ordered ? value <= from[i] : value >= from[i];
  const k = between(1) ? 0 : between(2) ? 1 : 2;
  const f = Math.max(0, Math.min(1, (value - from[k]) / (from[k+1] - from[k])));
  return to[k] + f * (to[k+1] - to[k]);
}

export function surfaceHeight(x, z) {
  const lon = origin[0] + x/kmPerDegree[0];
  const lat = origin[1] - z/kmPerDegree[1];
  const u = interpolate(lon, grid.longitude, grid.segments);
  const v = interpolate(lat, grid.latitude, grid.segments);
  const i = Math.min(last-1, Math.floor(u)), j = Math.min(last-1, Math.floor(v));
  const tx=u-i, ty=v-j, k=j*size+i, samples=survey();
  return ((1-ty)*((1-tx)*samples[k]+tx*samples[k+1])+ty*((1-tx)*samples[k+size]+tx*samples[k+size+1]))/1000;
}

export function worldPoint([lon, lat], offset = 0) {
  const x=(lon-origin[0])*kmPerDegree[0], z=(origin[1]-lat)*kmPerDegree[1];
  return new Vector3(x,surfaceHeight(x,z)+offset,z);
}

export function terrainGeometry(step) {
  const h = survey();
  const segments = last/step;
  const geometry = new PlaneGeometry(1,1,segments,segments);
  const {position,uv} = geometry.attributes;
  // The survey is sampled more densely along the walking corridor.
  for(let row=0;row<=segments;row++) {
    const lat=interpolate(row*step,grid.segments,grid.latitude);
    for(let col=0;col<=segments;col++){
      const lon=interpolate(col*step,grid.segments,grid.longitude);
      const k=row*(segments+1)+col;
      position.setXYZ(k,(lon-origin[0])*kmPerDegree[0],h[(row*size+col)*step]/1000,(origin[1]-lat)*kmPerDegree[1]);
      uv.setXY(k,(lon-grid.longitude[0])/(grid.longitude[3]-grid.longitude[0]),(lat-grid.latitude[3])/(grid.latitude[0]-grid.latitude[3]));
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export const stationPositions = () => route.stops.map(p=>worldPoint(p,.065));

export function trailVertices() {
  const points = [];
  let prev;
  route.track.forEach(coords=>{
    const point=worldPoint(coords,.042);
    if(prev) {
      const steps=Math.ceil(prev.distanceTo(point)/.027);
      for(let i=1;i<steps;i++) {
        const v=prev.clone().lerp(point,i/steps);
        points.push(v.x,surfaceHeight(v.x,v.z)+.042,v.z);
      }
    }
    points.push(point.x,point.y,point.z);
    prev=point;
  });
  return points;
}
