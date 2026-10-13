import {box,softBox,merge,disc} from './Geo.js';
import {VEHICLE_SPECS} from '../../../../shared/mapgen/StreetDressing.js';
const P=(meta,build)=>({meta:{overhang:true,...meta},build});
export const TRAFFIC_PIECES={};
for(const [type,s] of Object.entries(VEHICLE_SPECS)){
 if(type==='car')continue;
 TRAFFIC_PIECES[type]=P({group:'vehicle',wheelCount:type==='eighteen_wheeler'?18:s.axles*2,footprint:[s.length,s.width],text:`Whole ${type.replaceAll('_',' ')} with ${s.axles} axles`},()=>{
  const L=s.length,car=type==='abandoned_car',bus=type==='bus',cab=L/2-1.05;
  const body=[],glass=[],trim=[],rubber=[],rims=[];
  body.push(softBox(L-.15,car?.7:1.35,1.8,.08,2).translate(0,car?.55:1.05,0));
  if(!car){
   if(!bus)body.push(box(1.9,.6,1.8,cab,1.4));
   glass.push(box(bus?L-.8:1.4,.55,1.84,bus?0:cab,1.3));
   if(!bus&&L>=10){body.push(box(L-3, .25,1.86,-1.2,1.65));for(let x=-L/2+.3;x<cab-1.6;x+=.7)trim.push(box(.05,1.15,1.85,x,.6));}
  }else{glass.push(box(1.6,.35,1.5,-.5,.8));trim.push(box(.8,.05,1.6,1.4,.75).rotateZ(.15));}
  const axles=s.axles===5?[-L/2+1,-L/2+1.8,-1,-.2,L/2-1]:Array.from({length:s.axles},(_,i)=>-L/2+1+i*(L-2)/(s.axles-1));
  for(const [i,x] of axles.entries())for(const z of type==='eighteen_wheeler'&&i<4?[-.9,-.66,.66,.9]:[-.9,.9]){rubber.push(disc(.34,.22,12,x,.34,z));rims.push(disc(.19,.24,12,x,.34,z));}
  trim.push(box(L-.1,.1,1.86,0,.42));
  return [{slot:car?'wreck':'carpaint',geometry:merge(body)},{slot:'glass_dark',geometry:merge(glass)},{slot:'frame',geometry:merge(trim)},{slot:'tyre',geometry:merge(rubber)},{slot:'chrome',geometry:merge(rims)}];
 });
}
TRAFFIC_PIECES.supply_crates=P({group:'street-cover',footprint:[2,1]},()=>[{slot:'crate',geometry:merge([softBox(.85,.8,.85,.04,1).translate(-.5,.4,0),softBox(.85,.65,.85,.04,1).translate(.5,.325,0)])},{slot:'iron',geometry:merge([box(1.9,.04,.06,0,.72,.35),box(1.9,.04,.06,0,.1,-.35)])}]);
TRAFFIC_PIECES.bike_rack=P({group:'street-cover',footprint:[2,1]},()=>[{slot:'iron',geometry:merge([box(1.85,.06,.55,0,.03),...[-.7,0,.7].flatMap(x=>[box(.04,.75,.04,x,0,-.25),box(.04,.75,.04,x,0,.25),box(.04,.04,.5,x,.72)])])}]);
TRAFFIC_PIECES.utility_cabinet=P({group:'street-cover',footprint:[2,1]},()=>[{slot:'frame',geometry:merge([box(1.85,.9,.75),...[-.4,.4].map(x=>box(.8,.75,.03,x,.08,.39))])},{slot:'lamp',geometry:box(.3,.05,.04,0,.65,.41)}]);
TRAFFIC_PIECES.parcel_locker=P({group:'street-cover',footprint:[2,1]},()=>[{slot:'carpaint',geometry:box(1.85,.92,.75)},{slot:'frame',geometry:merge([box(.04,.9,.04,0,0,.39),... [.3,.6].map(h=>box(1.85,.03,.04,0,h,.39))])}]);
TRAFFIC_PIECES.transit_shelter=P({group:'street-cover',footprint:[3,1]},()=>[{slot:'frame',geometry:merge([box(2.9,.12,.9,0,1.85),...[-1.3,1.3].map(x=>box(.06,1.9,.06,x,0,.35))])},{slot:'glass',geometry:box(2.8,1.6,.04,0,.18,.35)},{slot:'lamp',geometry:box(.65,.35,.06,1.1,1.1,-.3)}]);

TRAFFIC_PIECES.rooftop_ac=P({group:'street-cover',footprint:[2,2]},()=>[{slot:'frame',geometry:box(1.85,1.75,1.85)},{slot:'iron',geometry:merge([box(1.8,.08,1.8,0,1.8),...[-.5,0,.5].map(x=>box(.03,1.3,1.87,x,.3))])}]);
