import {cropReferenceRegion} from '../../mapgen/ReferenceRegion.js';
// Recorded read of the supplied Burger Town / aerial commercial-block reference.
// The photographic plane is approximated as a uniformly scaled 128×52 source frame.
export const FULL_BURGER_DISTRICT_SITE={
    version:2,id:'burger-district',name:'Burger District · Parcel Study',theme:'Roadside',timeOfDay:'day',
    frame:{width:128,height:52},maxDimension:192,source:'user-reference.png',objective:'recover',objectiveBuilding:'central-diner',
    buildings:[
        {id:'west-retail',bounds:[.05,.30,.22,.62],program:'shop',front:'e',storeys:1},
        {id:'west-service',bounds:[.035,.74,.22,.95],program:'garage',front:'e',storeys:1},
        {id:'north-diner',bounds:[.29,.08,.41,.31],program:'diner',front:'s',storeys:1},
        {id:'central-diner',bounds:[.51,.46,.64,.70],program:'diner',front:'w',storeys:1},
        {id:'north-office',bounds:[.73,.05,.895,.285],program:'office',front:'s',storeys:2},
        {id:'east-market',bounds:[.84,.44,.975,.675],program:'shop',front:'w',storeys:1},
        {id:'east-service',bounds:[.80,.82,.97,.99],program:'garage',front:'n',storeys:1}
    ],
    surfaces:[
        {bounds:[0,0,1,1],material:'lawn'},
        {bounds:[.025,.245,.25,.67],material:'concrete'},
        {bounds:[.018,.705,.255,.99],material:'concrete'},
        {bounds:[.28,.045,.44,.355],material:'concrete'},
        {bounds:[.33,.37,.675,.91],material:'concrete'},
        {bounds:[.70,.025,.93,.34],material:'concrete'},
        {bounds:[.79,.395,.99,.71],material:'concrete'},
        {bounds:[.755,.775,.99,1],material:'concrete'},
        {bounds:[.47,.43,.68,.75],material:'lawn'}
    ],
    roads:[
        {id:'highway',role:'arterial',width:7,points:[[0,.16],[.15,.105],[.31,.035],[.44,0]]},
        {id:'west-access',role:'collector',width:5,points:[[.245,.24],[.265,.49],[.29,.76],[.30,1]]},
        {id:'curved-boulevard',role:'collector',width:6,points:[[.47,0],[.48,.20],[.59,.34],[.70,.47],[.74,.64],[.70,.81],[.62,.93],[.55,1]]},
        {id:'east-crossroad',role:'collector',width:5,points:[[.61,.36],[.81,.355],[1,.33]]},
        {id:'south-access',role:'service',width:4,points:[[.735,.68],[.87,.745],[1,.75]]},
        {id:'central-drive',role:'service',width:3,points:[[.285,.68],[.36,.68],[.46,.68]]}
    ],
    parking:[
        {id:'west-front',bounds:[.04,.21,.205,.275],axis:'y'},
        {id:'central-west',bounds:[.35,.42,.46,.84],axis:'x'},
        {id:'central-south',bounds:[.48,.79,.62,.88],axis:'y'},
        {id:'north-office-front',bounds:[.73,.30,.895,.35],axis:'y'},
        {id:'east-market-front',bounds:[.785,.445,.825,.655],axis:'x'}
    ],
    parcelPlan:{plotType:'SmallTown',source:'MoreMapsPack/Config/XComParcels.ini',slots:[
        {id:'west-retail',size:'large',zone:'Retail',entrances:['street','service']},
        {id:'west-service',size:'small',zone:'Retail',entrances:['street','service']},
        {id:'north-diner',size:'medium',zone:'Retail',entrances:['street','service']},
        {id:'central-diner',size:'medium',zone:'Retail',objectiveTag:'Recover',entrances:['street','service']},
        {id:'north-office',size:'medium',zone:'Neighborhood',entrances:['street','service']},
        {id:'east-market',size:'medium',zone:'Retail',entrances:['street','service']},
        {id:'east-service',size:'small',zone:'Retail',entrances:['street','service']}
    ]},
    playableBoundary:[[0,0],[.53,0],[.54,.20],[.66,.36],[.75,.48],[.775,.65],[.75,.81],[.67,.92],[0,.92]],
    insertion:[.245,.86],flow:[[.31,.86],[.42,.72],[.465,.55]]
};

// User-requested upper-left scope: keep the three commercial anchors west of the curved road.
export const BURGER_DISTRICT_SITE=cropReferenceRegion(FULL_BURGER_DISTRICT_SITE,[0,0,.775,.92],{
    buildingIds:['west-retail','north-diner','central-diner'],name:'Burger District · Upper-left Parcels'
});
