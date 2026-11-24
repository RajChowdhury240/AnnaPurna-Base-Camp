import React, {Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame, useLoader, useThree} from '@react-three/fiber';
import {animate, motion, useReducedMotion} from 'framer-motion';
import {TextureLoader, SRGBColorSpace, NoToneMapping, MathUtils, Vector3, Spherical} from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Line2} from 'three/addons/lines/Line2.js';
import {LineGeometry} from 'three/addons/lines/LineGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {terrainGeometry, surfaceHeight, stationPositions, trailVertices} from './model.js';
import satelliteUrl from './sentinel.webp?inline';
import {stops, elevation} from '../data.js';

function Landscape({lite}) {
  const {gl,size} = useThree();
  const texture=useLoader(TextureLoader,satelliteUrl);
  const mesh=useMemo(()=>terrainGeometry(lite?2:1),[lite]);
  const route=useMemo(()=>{
    const geometry=new LineGeometry();
    geometry.setPositions(trailVertices());
    const material=new LineMaterial({color:0x78ffe1,linewidth:3.0,worldUnits:false,polygonOffset:true,polygonOffsetFactor:-2});
    return new Line2(geometry,material);
  },[]);
  useLayoutEffect(()=>{
    texture.colorSpace=SRGBColorSpace;
    texture.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());
    texture.needsUpdate=true;
    route.material.resolution.set(size.width,size.height);
  },[texture,gl,route,size]);
  useEffect(()=>()=>mesh.dispose(),[mesh]);
  useEffect(()=>()=>{route.geometry.dispose();route.material.dispose()},[route]);
  return <>
    <mesh geometry={mesh}>
      <meshLambertMaterial map={texture} emissiveMap={texture} emissive="white" emissiveIntensity={.51} />
    </mesh>
    <ambientLight intensity={.75}/><directionalLight position={[-30,47,18]} intensity={1.15} color="#fff9ef"/>
    <primitive object={route}/>
  </>;
}

const work = new Vector3();
const offset = new Vector3();
const spherical = new Spherical();
function CameraRig({bridge, markers, north, onReady, onInterrupt}) {
  const {gl,camera,invalidate,size}=useThree();
  const controls=useRef(null), animation=useRef(null);
  const targets=useMemo(stationPositions,[]);
  const reduced=useReducedMotion();
  const view=useRef(size); view.current=size;
  const halt=()=>{animation.current?.stop();animation.current=null};
  useLayoutEffect(()=>{
    const orbit = new OrbitControls(camera, gl.domElement);
    controls.current=orbit;
    orbit.enableDamping=true;orbit.dampingFactor=.12;
    orbit.minDistance=2;orbit.maxDistance=43;
    orbit.minPolarAngle=.13;orbit.maxPolarAngle=Math.PI*.473;
    orbit.rotateSpeed=.74;orbit.panSpeed=.6;orbit.zoomSpeed=.8;
    orbit.autoRotateSpeed=1.1;
    orbit.target.set(0,3.55,0);
    const home=()=>{
      const narrow=view.current.width<650;
      return {target:new Vector3(-.9,3.55,-.8),position:new Vector3(narrow?20:14,narrow?17:12.8,narrow?23:16.4)};
    };
    const frame=home(); orbit.target.copy(frame.target);camera.position.copy(frame.position);
    orbit.update();camera.updateMatrixWorld();
    function fly(position,target,duration=1.15) {
      halt();
      const a=camera.position.clone(),b=orbit.target.clone();
      const update=t=>{
        camera.position.lerpVectors(a,position,t);orbit.target.lerpVectors(b,target,t);
        orbit.update();invalidate();
      };
      if(reduced||duration===0) update(1);
      else animation.current=animate(0,1,{duration,ease:[.22,.7,.25,1],onUpdate:update,onComplete:()=>{animation.current=null}});
    }
    bridge.current={
      reset(instant=false){const f=home();fly(f.position,f.target,instant?0:1.05)},
      zoom(factor){
        offset.copy(camera.position).sub(orbit.target);
        const d=MathUtils.clamp(offset.length()*factor,orbit.minDistance,orbit.maxDistance);
        fly(orbit.target.clone().add(offset.setLength(d)),orbit.target.clone(),.3);
      },
      turn(azimuth,tilt=0){
        halt(); spherical.setFromVector3(offset.copy(camera.position).sub(orbit.target));
        spherical.theta+=azimuth;spherical.phi=MathUtils.clamp(spherical.phi+tilt,orbit.minPolarAngle,orbit.maxPolarAngle);
        camera.position.copy(orbit.target).add(offset.setFromSpherical(spherical));orbit.update();invalidate();
      },
      focus(i) {
        const t=targets[i].clone();t.y+=.15;
        const delta=new Vector3(4.6+(i%3)*.2,3.7,5.7);
        fly(t.clone().add(delta),t,1.65);
      },
      spin(enabled){orbit.autoRotate=enabled;invalidate()},
      cancel(){halt()},
      refresh(){invalidate()}
    };
    const change=()=>invalidate();
    const interrupt=()=>{halt();onInterrupt()};
    orbit.addEventListener('change',change);orbit.addEventListener('start',interrupt);
    onReady();invalidate();
    return ()=>{halt();bridge.current=null;orbit.dispose();orbit.removeEventListener('change',change);orbit.removeEventListener('start',interrupt)};
  },[camera,gl,bridge,invalidate,onReady,onInterrupt,reduced,targets]);
  useFrame((_,dt)=>{
    const orbit=controls.current;if(!orbit)return;
    orbit.target.x=MathUtils.clamp(orbit.target.x,-19,19);orbit.target.z=MathUtils.clamp(orbit.target.z,-23,18);
    orbit.target.y=MathUtils.clamp(orbit.target.y,1,7.2);
    orbit.update(Math.min(dt,.05));
    camera.position.y=Math.max(camera.position.y,surfaceHeight(camera.position.x,camera.position.z)+.23);
    camera.lookAt(orbit.target);camera.updateMatrixWorld();
    if(orbit.autoRotate)invalidate();
    const bearing=((180-MathUtils.radToDeg(orbit.getAzimuthalAngle()))+180)%360;
    if(north.current){north.current.style.setProperty('--heading',MathUtils.radToDeg(orbit.getAzimuthalAngle())+'deg');north.current.dataset.heading=String(Math.round(bearing))}
    targets.forEach((point,i)=>{
      const button=markers.current[i];if(!button)return;
      work.copy(point).project(camera);
      let visible=work.z>=-1 && work.z<1 && Math.abs(work.x)<.985 && Math.abs(work.y)<.975;
      // Use the same survey for line-of-sight and geometry, including the rear view.
      for(let s=1;visible&&s<38;s++){
        const t=s/38,x=point.x+(camera.position.x-point.x)*t,z=point.z+(camera.position.z-point.z)*t;
        if(surfaceHeight(x,z)>point.y+(camera.position.y-point.y)*t+.06)visible=false;
      }
      button.hidden=!visible;
      if(visible){button.style.left=((work.x*.5+.5)*100)+'%';button.style.top=((.5-work.y*.5)*100)+'%'}
    });
  });
  return null;
}

class ViewError extends Component {
  state={error:false};
  static getDerivedStateFromError(){return {error:true}}
  componentDidCatch(){this.props.onError()}
  render(){return this.state.error?null:this.props.children}
}

export function mountViewer(host,events) {
  const bridge={current:null},north={current:null};
  let active=-1,selectedChanged=()=>{};
  function View(){
    const markers=useRef([]),[selected,setSelected]=useState(active),[status,setStatus]=useState('loading');
    selectedChanged=setSelected;
    const lite=useMemo(()=>matchMedia('(max-width:800px)').matches,[]);
    const ready=useMemo(()=>()=>{setStatus('ready');events.ready()},[]);
    const failed=useMemo(()=>()=>{setStatus('unavailable');events.failed()},[]);
    useEffect(()=>{
      const onLoss=e=>{e.preventDefault();failed()};
      host.addEventListener('webglcontextlost',onLoss,true);
      return ()=>host.removeEventListener('webglcontextlost',onLoss,true);
    },[failed]);
    return <>
      {status!=='unavailable' && <ViewError onError={failed}><Canvas
        frameloop="demand" dpr={[1,lite?1.4:1.7]} camera={{fov:43,near:.025,far:180}}
        gl={{antialias:true,alpha:true,powerPreference:'high-performance',toneMapping:NoToneMapping}}
        fallback={<div ref={n=>{if(n)queueMicrotask(failed)}}/>}>
        <fogExp2 attach="fog" args={['#bfd8e6',.016]}/>
        <Suspense fallback={null}><Landscape lite={lite}/><CameraRig {...{bridge,markers,north,onReady:ready,onInterrupt:events.interrupt}}/></Suspense>
      </Canvas></ViewError>}
      {status==='ready' && <>
        <div id="markers">{stops.map((s,i)=><button key={s.id} hidden ref={node=>{markers.current[i]=node}} className={'marker marker-'+(s.label||'plain')+(selected===i?' touring':'')} aria-label={'Explore '+s.name+', '+elevation(s)} onClick={()=>events.stop(i)}>
          <span className="marker-dot"/><span className={'marker-label '+(s.label==='summit'?'elevated':'')+' '+(s.label||selected===i?'':'optional')}>{s.name}{s.label==='summit'&&<small>{elevation(s)}</small>}</span>
        </button>)}</div>
        <button className="north-control" ref={node=>{north.current=node}} title="Reset camera to route overview" aria-label="Reset camera to route overview" onClick={events.reset}><span>N</span><i/></button>
      </>}
      {status==='loading'&&<motion.div className="survey-status" role="status" initial={{opacity:0}} animate={{opacity:1}}>Loading mountain terrain…</motion.div>}
      {status==='unavailable'&&<div className="map-fallback"><img src={satelliteUrl} alt="Satellite mosaic of the Annapurna massif"/><div><strong>Satellite overview</strong><p>This browser could not open the 3D view.</p><button onClick={events.stairs}>Explore the elevation staircase</button></div></div>}
    </>;
  }
  const root=createRoot(host);root.render(<View/>);
  return {
    zoom:factor=>bridge.current?.zoom(factor),turn:(x,y)=>bridge.current?.turn(x,y),
    reset:instant=>bridge.current?.reset(instant),spin:on=>bridge.current?.spin(on),cancel:()=>bridge.current?.cancel(),
    focus(i){active=i;selectedChanged(i);if(i>=0)bridge.current?.focus(i);bridge.current?.refresh()},
    refresh:()=>bridge.current?.refresh()
  };
}
