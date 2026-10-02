import {createCanvas,loadImage} from '@napi-rs/canvas';
import {readFile} from 'node:fs/promises';

const width=1200,height=1600;
const dateText=date=>new Intl.DateTimeFormat('pl-PL',{dateStyle:'long',timeZone:'Europe/Warsaw'}).format(new Date(date));
const fit=(ctx,text,max,size)=>{let value=size;ctx.font=`700 ${value}px Arial`;while(ctx.measureText(text).width>max&&value>34){value-=2;ctx.font=`700 ${value}px Arial`;}return value;};
export async function createDiploma({name,rank,issuedAt=new Date()}){
 const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
 const bg=ctx.createLinearGradient(0,0,width,height);bg.addColorStop(0,'#0a0708');bg.addColorStop(.5,'#241013');bg.addColorStop(1,'#080606');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
 ctx.strokeStyle='#ff3b30';ctx.lineWidth=9;ctx.shadowColor='#ff2419';ctx.shadowBlur=28;ctx.strokeRect(37,37,width-74,height-74);ctx.shadowBlur=0;
 ctx.strokeStyle='#9d201c';ctx.lineWidth=2;ctx.strokeRect(58,58,width-116,height-116);
 const logo=await loadImage(await readFile(new URL('../public/discord-avatar.jpg',import.meta.url)));ctx.drawImage(logo,850,95,230,230);
 ctx.fillStyle='#ff5148';ctx.font='700 26px Arial';ctx.letterSpacing='4px';ctx.fillText('BURGER SHOT • STAFF OFFICE',86,125);ctx.letterSpacing='0px';
 ctx.fillStyle='#f7d18a';ctx.font='700 78px Georgia';ctx.textAlign='center';ctx.fillText('DYPLOM AWANSU',width/2,465);
 ctx.strokeStyle='#e0aa53';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(215,510);ctx.lineTo(985,510);ctx.stroke();
 ctx.fillStyle='#e8d8bd';ctx.font='34px Georgia';ctx.fillText('Przyznaje się',width/2,630);
 const nameSize=fit(ctx,String(name),900,104);ctx.fillStyle='#ffe1a1';ctx.shadowColor='#e23b2f';ctx.shadowBlur=18;ctx.font=`700 ${nameSize}px Georgia`;ctx.fillText(String(name),width/2,770);ctx.shadowBlur=0;
 ctx.fillStyle='#e8d8bd';ctx.font='31px Georgia';ctx.fillText('za awans na stanowisko',width/2,885);
 const rankSize=fit(ctx,String(rank).toUpperCase(),900,74);ctx.fillStyle='#ff665b';ctx.shadowColor='#ff2419';ctx.shadowBlur=16;ctx.font=`700 ${rankSize}px Arial`;ctx.fillText(String(rank).toUpperCase(),width/2,1000);ctx.shadowBlur=0;
 ctx.strokeStyle='#e0aa53';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(310,1070);ctx.lineTo(890,1070);ctx.stroke();
 ctx.fillStyle='#e0aa53';ctx.beginPath();ctx.arc(width/2,1200,94,0,Math.PI*2);ctx.fill();ctx.fillStyle='#29100d';ctx.font='700 62px Georgia';ctx.fillText('BS',width/2,1223);
 ctx.fillStyle='#e8d8bd';ctx.font='27px Arial';ctx.fillText(`Data awansu: ${dateText(issuedAt)}`,width/2,1390);ctx.font='700 25px Arial';ctx.fillText('BurgerShot • Zarząd',width/2,1450);
 return canvas.encode('png');
}
export async function sendDiploma(client,{userId,name,rank,issuedAt}){
 const image=await createDiploma({name,rank,issuedAt});
 const user=await client.users.fetch(userId);
 await user.send({files:[{attachment:image,name:'dyplom-awansu-burgershot.png'}]});
}

