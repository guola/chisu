"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Check, CheckCircle2, Download, FileArchive, FileText, Image as ImageIcon,
  Laptop, LoaderCircle, LockKeyhole, Music2, QrCode, Smartphone, Upload,
  Wifi, X, Zap,
} from "lucide-react";

type Stage = "creating" | "waiting" | "connecting" | "connected" | "error";
type Transfer = { id:string; name:string; size:number; progress:number; direction:"send"|"receive"; status:"active"|"done"|"error"; url?:string };
type FileMessage = { type:"meta"; id:string; name:string; size:number; mime:string } | { type:"end"; id:string };
type SignalMessage = { type:string; sdp?:RTCSessionDescriptionInit; candidate?:RTCIceCandidateInit; message?:string };

const formatBytes=(value:number)=>{const units=["B","KB","MB","GB"];if(!value)return "0 B";const i=Math.min(Math.floor(Math.log(value)/Math.log(1024)),3);return `${(value/1024**i).toFixed(i?1:0)} ${units[i]}`;};
const fileIcon=(name:string)=>{const ext=name.split(".").pop()?.toLowerCase();if(["png","jpg","jpeg","gif","webp","heic"].includes(ext||""))return ImageIcon;if(["mp3","wav","m4a","flac"].includes(ext||""))return Music2;if(["zip","rar","7z","tar","gz"].includes(ext||""))return FileArchive;return FileText;};
const makeId=()=>`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;

export default function Home(){
  const [stage,setStage]=useState<Stage>("creating");
  const [isGuest,setIsGuest]=useState(false);
  const [qr,setQr]=useState("");
  const [joinUrl,setJoinUrl]=useState("");
  const [error,setError]=useState("");
  const [dragging,setDragging]=useState(false);
  const [transfers,setTransfers]=useState<Transfer[]>([]);
  const pcRef=useRef<RTCPeerConnection|null>(null);
  const socketRef=useRef<WebSocket|null>(null);
  const channelRef=useRef<RTCDataChannel|null>(null);
  const inputRef=useRef<HTMLInputElement>(null);
  const initialized=useRef(false);
  const negotiated=useRef(false);
  const pendingCandidates=useRef<RTCIceCandidateInit[]>([]);
  const incoming=useRef<{id:string;name:string;size:number;mime:string;chunks:ArrayBuffer[];received:number}|null>(null);

  const patchTransfer=useCallback((id:string,patch:Partial<Transfer>)=>setTransfers(items=>items.map(item=>item.id===id?{...item,...patch}:item)),[]);

  const setupChannel=useCallback((channel:RTCDataChannel)=>{
    channelRef.current=channel;
    channel.binaryType="arraybuffer";
    channel.onopen=()=>{setStage("connected");setError("");};
    channel.onclose=()=>{setError("设备连接已断开，请刷新两端页面重新连接");setStage("error");};
    channel.onerror=()=>{setError("传输通道发生错误，请重新连接");setStage("error");};
    channel.onmessage=(event)=>{
      if(typeof event.data==="string"){
        const message=JSON.parse(event.data) as FileMessage;
        if(message.type==="meta"){
          incoming.current={...message,chunks:[],received:0};
          setTransfers(items=>[{id:message.id,name:message.name,size:message.size,progress:0,direction:"receive",status:"active"},...items]);
        }else if(message.type==="end"&&incoming.current?.id===message.id){
          const file=incoming.current;
          const url=URL.createObjectURL(new Blob(file.chunks,{type:file.mime}));
          patchTransfer(file.id,{progress:100,status:"done",url});
          incoming.current=null;
        }
      }else if(incoming.current){
        const chunk=event.data as ArrayBuffer;
        incoming.current.chunks.push(chunk);
        incoming.current.received+=chunk.byteLength;
        patchTransfer(incoming.current.id,{progress:Math.min(100,incoming.current.received/incoming.current.size*100)});
      }
    };
  },[patchTransfer]);

  useEffect(()=>{
    if(initialized.current)return;
    initialized.current=true;
    const params=new URLSearchParams(window.location.search);
    const roomFromUrl=params.get("room");
    const guest=Boolean(roomFromUrl);
    const room=roomFromUrl||makeId();
    setIsGuest(guest);

    const pc=new RTCPeerConnection({iceServers:[]});
    pcRef.current=pc;
    if(guest) pc.ondatachannel=event=>setupChannel(event.channel);
    else setupChannel(pc.createDataChannel("flashdrop",{ordered:true}));

    const protocol=window.location.protocol==="https:"?"wss":"ws";
    const socket=new WebSocket(`${protocol}://${window.location.hostname}:3001`);
    socketRef.current=socket;
    const send=(message:object)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
    const applyPending=async()=>{for(const candidate of pendingCandidates.current)await pc.addIceCandidate(candidate);pendingCandidates.current=[];};

    pc.onicecandidate=event=>{if(event.candidate)send({type:"candidate",candidate:event.candidate.toJSON()});};
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==="connected")setStage("connected");
      if(pc.connectionState==="failed"){setError("未能连接设备，请确认两台设备连接同一 Wi-Fi 后刷新重试");setStage("error");}
    };

    socket.onopen=async()=>{
      send({type:"join",room,role:guest?"guest":"host"});
      if(!guest){
        const joinUrl=`${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(room)}`;
        setJoinUrl(joinUrl);
        setQr(await QRCode.toDataURL(joinUrl,{width:520,margin:1,errorCorrectionLevel:"M",color:{dark:"#12221b",light:"#ffffff"}}));
        setStage("waiting");
      }else setStage("connecting");
    };

    socket.onmessage=async(event)=>{
      try{
        const message=JSON.parse(event.data) as SignalMessage;
        if(message.type==="ready"&&!guest&&!negotiated.current){
          negotiated.current=true;
          setStage("connecting");
          const offer=await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({type:"offer",sdp:pc.localDescription});
        }else if(message.type==="offer"&&guest&&message.sdp){
          await pc.setRemoteDescription(message.sdp);
          await applyPending();
          const answer=await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({type:"answer",sdp:pc.localDescription});
        }else if(message.type==="answer"&&!guest&&message.sdp){
          await pc.setRemoteDescription(message.sdp);
          await applyPending();
        }else if(message.type==="candidate"&&message.candidate){
          if(pc.remoteDescription)await pc.addIceCandidate(message.candidate);
          else pendingCandidates.current.push(message.candidate);
        }else if(message.type==="peer-left"&&channelRef.current?.readyState!=="open"){
          setError("另一台设备已离开，请刷新页面重新扫码");setStage("error");
        }else if(message.type==="error"){
          setError(message.message||"无法加入会话，请刷新页面重试");setStage("error");
        }
      }catch(err){
        console.error("WebRTC negotiation failed",err);
        setError("连接协商失败，请刷新两端页面重新扫码");setStage("error");
      }
    };
    socket.onerror=()=>{if(channelRef.current?.readyState!=="open"){setError("本地连接服务未启动，请在电脑上重新运行项目");setStage("error");}};

    return()=>{socket.close();pc.close();};
  },[setupChannel]);

  const sendFiles=useCallback(async(files:FileList|File[])=>{
    const channel=channelRef.current;
    if(!channel||channel.readyState!=="open"){setError("请先用手机扫码完成连接");return;}
    for(const file of Array.from(files)){
      const id=makeId();
      setTransfers(items=>[{id,name:file.name,size:file.size,progress:0,direction:"send",status:"active"},...items]);
      channel.send(JSON.stringify({type:"meta",id,name:file.name,size:file.size,mime:file.type||"application/octet-stream"} satisfies FileMessage));
      const chunkSize=64*1024;
      for(let offset=0;offset<file.size;offset+=chunkSize){
        while(channel.bufferedAmount>4*1024*1024)await new Promise(resolve=>setTimeout(resolve,30));
        const chunk=await file.slice(offset,offset+chunkSize).arrayBuffer();
        channel.send(chunk);
        patchTransfer(id,{progress:Math.min(100,(offset+chunk.byteLength)/file.size*100)});
      }
      channel.send(JSON.stringify({type:"end",id} satisfies FileMessage));
      patchTransfer(id,{progress:100,status:"done"});
    }
  },[patchTransfer]);

  const connected=stage==="connected";
  const status=stage==="creating"?"正在创建本地会话":stage==="waiting"?"等待手机扫码":stage==="connecting"?"正在连接设备":connected?"设备已连接":"连接遇到问题";
  const sub=stage==="waiting"?"轻扫二维码，即可相逢":stage==="connecting"?"正在让两端悄然相通":connected?"尺素往来，只抵彼端":"请保持页面开启";

  return <main className="shell">
    <nav className="topbar"><div className="brand"><span className="brandMark"><Zap size={19} fill="currentColor"/></span><span>尺素</span></div><div className="privacy"><LockKeyhole size={14}/><span>端到端直传 · 雪泥无痕</span></div></nav>
    <section className="hero"><div className="eyebrow"><span/> 无需繁文 · 照面即通</div><h1>山水有距，<em>尺素无间。</em></h1><p>一眼相逢，两端即通。文件越过屏幕，只抵彼端。<br/>不入云端，不留副本。</p></section>
    <section className="workspace">
      <div className="sessionCard">
        <div className="sessionHead"><div className={`statusDot ${connected?"online":""}`}><span/></div><div><strong>{status}</strong><small>{sub}</small></div>{connected&&<span className="connectedTag"><Check size={13}/>已连接</span>}</div>
        {!isGuest&&!connected&&stage!=="error"&&<div className="qrArea" data-join-url={joinUrl}>
          <div className="qrFrame">{qr?<img src={qr} alt="连接二维码"/>:<LoaderCircle className="spin" size={38}/>}<span className="corner c1"/><span className="corner c2"/><span className="corner c3"/><span className="corner c4"/></div>
          <div className="steps"><div><b>1</b><span><strong>一眼相逢</strong><small>手机轻扫二维码</small></span></div><div><b>2</b><span><strong>两端意通</strong><small>无需确认，自动直连</small></span></div><div><b>3</b><span><strong>尺素即达</strong><small>任意文件，双向直传</small></span></div></div>
        </div>}
        {(isGuest||connected)&&stage!=="error"&&<div className="deviceArea"><div className="devicePair"><div><Laptop size={32}/></div><span><i/><i/><i/></span><div><Smartphone size={28}/></div></div><h2>{connected?"一眼相逢，尺素即通":"正在与彼端相逢…"}</h2><p>{connected?"现在可以双向直传文件了":"转瞬即达，请稍候"}</p></div>}
        {error&&<div className="errorBar"><X size={15}/>{error}</div>}
      </div>
      <div className={`dropCard ${dragging?"dragging":""} ${!connected?"disabled":""}`} onDragOver={event=>{event.preventDefault();if(connected)setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();setDragging(false);if(connected)sendFiles(event.dataTransfer.files)}} onClick={()=>connected&&inputRef.current?.click()}>
        <input ref={inputRef} type="file" multiple onChange={event=>event.target.files&&sendFiles(event.target.files)}/><span className="uploadIcon"><Upload size={26}/></span><strong>{connected?"拖拽文件到这里":"扫码后即可发送文件"}</strong><p>{connected?"或点击选择文件 · 支持多选":"文件不会上传到本地服务"}</p><button disabled={!connected}><Upload size={16}/>选择文件</button>
      </div>
    </section>
    {transfers.length>0&&<section className="transferList"><div className="listHead"><h2>传输记录</h2><button onClick={()=>setTransfers([])}>清空记录</button></div>{transfers.map(item=>{const Icon=fileIcon(item.name);return <div className="transfer" key={item.id}><span className="fileIcon"><Icon size={21}/></span><div className="fileMeta"><div><strong>{item.name}</strong><small>{item.direction==="send"?"发送":"接收"} · {formatBytes(item.size)}</small></div><div className="progress"><span style={{width:`${item.progress}%`}}/></div></div>{item.status==="done"?(item.url?<a href={item.url} download={item.name}><Download size={19}/></a>:<CheckCircle2 className="done" size={20}/>):<b>{Math.round(item.progress)}%</b>}</div>})}</section>}
    <footer><span><LockKeyhole size={13}/>无需繁文</span><span><Wifi size={13}/>两端直达</span><span><QrCode size={13}/>照面即通</span><p>清风为驿 · WebRTC 端到端传输</p></footer>
  </main>;
}
