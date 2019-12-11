"use strict"

////////////////////////////// CONST definitions

const EYE_HEIGHT       = 0;//0.0254 *  69;
const CUBE_SIZE        = 0.2;
const ROOM_SIZE        = 6;
const BALL_SIZE        = 0.02;
const BALL_SPEED       = 3;
const PAD_SIZE         = 0.3;

////////////////////////////// SCENE SPECIFIC CODE

async function setup(state) {
    hotReloadFile(getPath('week9.js'));

    const images = await imgutil.loadImagesPromise([
      getPath("textures/brick1.jpg"),
      getPath("textures/brick2.jpg"),
      getPath("textures/brick3.jpg"),
      getPath("textures/cyber1.jpg")
    ]);

    let libSources = await MREditor.loadAndRegisterShaderLibrariesForLiveEditing(gl, "libs", [
        { key : "pnoise"    , path : "shaders/noise.glsl"     , foldDefault : true },
        { key : "sharedlib1", path : "shaders/sharedlib1.glsl", foldDefault : true },      
    ]);
    if (! libSources)
        throw new Error("Could not load shader library");

    // load vertex and fragment shaders from the server, register with the editor
    let shaderSource = await MREditor.loadAndRegisterShaderForLiveEditing(
        gl,
        "mainShader",
        { 
            onNeedsCompilation : (args, libMap, userData) => {
                const stages = [args.vertex, args.fragment];
                const output = [args.vertex, args.fragment];
                const implicitNoiseInclude = true;
                if (implicitNoiseInclude) {
                    let libCode = MREditor.libMap.get('pnoise');
                    for (let i = 0; i < 2; i++) {
                        const stageCode = stages[i];
                        const hdrEndIdx = stageCode.indexOf(';');
                        const hdr = stageCode.substring(0, hdrEndIdx + 1);
                        output[i] = hdr + '\n#line 2 1\n' + 
                                    '#include<pnoise>\n#line ' + (hdr.split('\n').length + 1) + ' 0' + 
                                    stageCode.substring(hdrEndIdx + 1);
                    }
                }
                MREditor.preprocessAndCreateShaderProgramFromStringsAndHandleErrors(
                    output[0],
                    output[1],
                    libMap
                );
            },
            onAfterCompilation : (program) => {
                gl.useProgram(state.program = program);
                state.uColorLoc    = gl.getUniformLocation(program, 'uColor');
                state.uCursorLoc   = gl.getUniformLocation(program, 'uCursor');
                state.uModelLoc    = gl.getUniformLocation(program, 'uModel');
                state.uProjLoc     = gl.getUniformLocation(program, 'uProj');
                state.uTexScale    = gl.getUniformLocation(program, 'uTexScale');
                state.uTexIndexLoc = gl.getUniformLocation(program, 'uTexIndex');
                state.uTimeLoc     = gl.getUniformLocation(program, 'uTime');
                state.uViewLoc     = gl.getUniformLocation(program, 'uView');
		state.uTexLoc = [];
		for (let n = 0 ; n < 8 ; n++) {
		   state.uTexLoc[n] = gl.getUniformLocation(program, 'uTex' + n);
                   gl.uniform1i(state.uTexLoc[n], n);
		}
            } 
        },
        {
            paths : {
                vertex   : "shaders/vertex.vert.glsl",
                fragment : "shaders/fragment.frag.glsl"
            },
            foldDefault : {
                vertex   : true,
                fragment : false
            }
        }
    );
    if (! shaderSource)
        throw new Error("Could not load shader");

    state.cursor = ScreenCursor.trackCursor(MR.getCanvas());

    state.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);

    let bpe = Float32Array.BYTES_PER_ELEMENT;

    let aPos = gl.getAttribLocation(state.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, bpe * VERTEX_SIZE, bpe * 0);

    let aNor = gl.getAttribLocation(state.program, 'aNor');
    gl.enableVertexAttribArray(aNor);
    gl.vertexAttribPointer(aNor, 3, gl.FLOAT, false, bpe * VERTEX_SIZE, bpe * 3);

    let aUV  = gl.getAttribLocation(state.program, 'aUV');
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV , 2, gl.FLOAT, false, bpe * VERTEX_SIZE, bpe * 6);

    for (let i = 0 ; i < images.length ; i++) {
        gl.activeTexture (gl.TEXTURE0 + i);
        gl.bindTexture   (gl.TEXTURE_2D, gl.createTexture());
        gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
        gl.texParameteri (gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D    (gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images[i]);
        gl.generateMipmap(gl.TEXTURE_2D);
    }
}

//let noise = new ImprovedNoise();
let m = new Matrix();
let turnAngle = 0, tiltAngle = 0, cursorPrev = [0,0,0];

/*--------------------------------------------------------------------------------
 abstraction on top of the left and right controller
--------------------------------------------------------------------------------*/

function ControllerHandler(controller) {
   this.lspeed      = () => controller.pose.linearVelocity;
   this.isDown      = () => controller.buttons[1].pressed;
   this.onEndFrame  = () => wasDown = this.isDown();
   this.orientation = () => controller.pose.orientation;
   this.position    = () => controller.pose.position;
   this.press       = () => ! wasDown && this.isDown();
   this.release     = () => wasDown && ! this.isDown();
   this.sideButton  = () => controller.buttons[2].pressed;
   this.Acceleration = () => controller.pose.linearAcceleration;
   this.Velocity = () => controller.pose.linearVelocity;
   this.tip         = () => {
      let P = this.position();          // THIS CODE JUST MOVES
      m.identity();                     // THE "HOT SPOT" OF THE
      m.translate(P[0], P[1], P[2]);    // CONTROLLER TOWARD ITS
      m.rotateQ(this.orientation());    // FAR TIP (FURTHER AWAY
      m.translate(0,0,-.03);            // FROM THE USER'S HAND).
      let v = m.value();
      return [v[12],v[13],v[14]];
   }
   let wasDown = false;
}

/*--------------------------------------------------------------------------------
 Initialization of left, right controller and whether the ball is launched
--------------------------------------------------------------------------------*/

let LC, RC, isInit=false;

/*--------------------------------------------------------------------------------
 bricks constructions
--------------------------------------------------------------------------------*/

let bricks = [];
for(let i = 0;i<5;i++){
   for(let j = 0;j<5;j++){
      let brick = new Brick((i+j)%3);
      brick.position = [0,j/2+1,-5+j/2];
      brick.angle = i;
      bricks.push(brick);
   }
}
let brick = new Brick(1);
brick.angle = 0;
brick.position = [0,0,0.5];
bricks.push(brick);

function onStartFrame(t, state) {

    /*-----------------------------------------------------------------
    Whenever the user enters VR Mode, create the left and right
    controller handlers.
    -----------------------------------------------------------------*/

    if (MR.VRIsActive()) {
       if (! LC) LC = new ControllerHandler(MR.leftController);
       if (! RC) RC = new ControllerHandler(MR.rightController);

       if (! state.calibrate) {
          m.identity();
          state.calibrate = m.value().slice();
       }
    }

    if (! state.tStart)
        state.tStart = t;
    state.time = (t - state.tStart) / 1000;

    // THIS CURSOR CODE IS ONLY RELEVANT WHEN USING THE BROWSER MOUSE, NOT WHEN IN VR MODE.

    let cursorValue = () => {
       let p = state.cursor.position(), canvas = MR.getCanvas();
       return [ p[0] / canvas.clientWidth * 2 - 1, 1 - p[1] / canvas.clientHeight * 2, p[2] ];
    }

    let cursorXYZ = cursorValue();
    if (cursorXYZ[2] && cursorPrev[2]) {
        turnAngle -= Math.PI/2 * (cursorXYZ[0] - cursorPrev[0]);
        tiltAngle += Math.PI/2 * (cursorXYZ[1] - cursorPrev[1]);
    }
    cursorPrev = cursorXYZ;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniform3fv(state.uCursorLoc, cursorXYZ);
    gl.uniform1f (state.uTimeLoc  , state.time);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);

    /*-----------------------------------------------------------------
    Below is the logic for the launch of the ball.
    When RightButton is released, the ball get all the parameters
    and the game starts.
    -----------------------------------------------------------------*/

    if (LC){
      if (RC.press()){
         isInit = true;
      }
      if(isInit==true && isStart==false && RC.release()){
         let ball = balls[0];
         let pos = RC.tip().slice();
         ball.position = pos;
         ball.releasePosition = pos;
         ball.orientation = RC.orientation().slice();
         m.save();
            m.identity();
            m.rotateQ(RC.orientation());
            let t = m.value();
            ball.velocity = vectorMulti(neg(normalize(getOriZ(t))), BALL_SPEED);
         m.restore();
         
         ball.scale = [BALL_SIZE, BALL_SIZE, BALL_SIZE];
         ball.flag = true;
         ball.touch = false;
         ball.StartTime = state.time;
         isStart=true;
         isInit=false;
      }
    }
}


/*-----------------------------------------------------------------
Some function and parameter definitions
-----------------------------------------------------------------*/


function Obj(shape) {
   this.shape = shape;
};

function Brick(color) {
   this.color = color;
};

let balls = [];
balls.push(new Obj(sphere));
let isStart = false;
let threshold = 0.04

function onDraw(t, projMat, viewMat, state, eyeIdx) {
    gl.uniformMatrix4fv(state.uViewLoc, false, new Float32Array(viewMat));
    gl.uniformMatrix4fv(state.uProjLoc, false, new Float32Array(projMat));

    let prev_shape = null;

    /*-----------------------------------------------------------------

    The drawShape() function below is optimized in that it only downloads
    new vertices to the GPU if the vertices (the "shape" argument) have
    changed since the previous call.

    Also, currently we only draw gl.TRIANGLES if this is a cube. In all
    other cases, we draw gl.TRIANGLE_STRIP. You might want to change
    this if you create other kinds of shapes that are not triangle strips.

    -----------------------------------------------------------------*/

    let drawShape = (shape, color, texture, textureScale) => {
       gl.uniform3fv(state.uColorLoc, color);
       gl.uniformMatrix4fv(state.uModelLoc, false, m.value());
       gl.uniform1i(state.uTexIndexLoc, texture === undefined ? -1 : texture);
       gl.uniform1f(state.uTexScale, textureScale === undefined ? 1 : textureScale);
       if (shape != prev_shape)
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array( shape ), gl.STATIC_DRAW);
       gl.drawArrays(shape == cube ? gl.TRIANGLES : gl.TRIANGLE_STRIP, 0, shape.length / VERTEX_SIZE);
       prev_shape = shape;
    }

   
    /*-----------------------------------------------------------------
    Below is the pad shape and brick definition
    -----------------------------------------------------------------*/

    let drawController = (C, color) => {
       let P = C.position(), s = C.isDown() ? .0125 : .0225;
       m.save();
          m.translate(P[0], P[1], P[2]);
          m.rotateQ(C.orientation());
            m.save();
               m.translate(0,0,0.01);
               m.scale(PAD_SIZE,PAD_SIZE,0.005);
               drawShape(cylinder, color);
            m.restore();
	         m.save();
               m.translate(0,0,.025);
               m.scale(.015,.015,.01);
               drawShape(cube, [0,0,0]);
	         m.restore();
	         m.save();
	            m.translate(0,0,.035);
	            m.rotateX(.5);
	               m.save();
                     m.translate(0,-.001,.035);
                     m.scale(.014,.014,.042);
                     drawShape(cylinder, [0,0,0]);
	               m.restore();
	               m.save();
	                  m.translate(0,-.001,.077);
	                  m.scale(.014,.014,.014);
                     drawShape(sphere, [0,0,0]);
	               m.restore();
	         m.restore();
       m.restore();
    }

    let drawCube = (m,color) =>{
      m.save();
         m.scale(CUBE_SIZE,CUBE_SIZE,CUBE_SIZE);
         drawShape(cube,[3,3,3],color,1);
      m.restore();
    }

    /*---------------------------------------------------------------------
    Below is the logic for the collision between ball and pad.
    ---------------------------------------------------------------------*/
   let isTouch = (ball, C) => {
      let ballPos = ball.position;
      let conPos = C.position();
      let dz = Math.abs(ballPos[2]-conPos[2]);
      if (dz>threshold){
         return false;
      }
      else{
         let dx = ballPos[0]-conPos[0];
         let dy = ballPos[1]-conPos[1];
         if (dx*dx+dy*dy>PAD_SIZE*PAD_SIZE){
            return false;
         }
         else{
            return true;
         }
      }

   }

   /*---------------------------------------------------------------------
    Below is the logic for the collision between ball and brick.
    ---------------------------------------------------------------------*/

   let hitBrick = (ballPos)=>{
      for(let i = 0;i<bricks.length;i++){
         let b_x = Math.sin(bricks[i].angle/2)*bricks[i].position[2];
         let b_y = bricks[i].position[1];
         let b_z = Math.cos(bricks[i].angle/2)*bricks[i].position[2];
         let x = ballPos[0]-b_x;
         let y = ballPos[1]-b_y;
         let z = ballPos[2]-b_z;
         if(Math.abs(x)<=CUBE_SIZE&& Math.abs(y)<=CUBE_SIZE&& Math.abs(z)<=CUBE_SIZE){
            let maxVal = Math.max(Math.abs(x),Math.max(Math.abs(y),Math.abs(z)));
            let norm = [];
            if(maxVal == x){
               norm = normalize([-b_z,0,b_x]);
            }else if(maxVal == -x){
               norm = normalize([b_z,0,-b_x]);
            }else if(maxVal == y){
               norm = [0,1,0];
            }else if(maxVal == -y){
               norm = [0,-1,0];
            }else if(maxVal == z){
               norm = normalize([-b_x,0,-b_z]);
            }else if(maxVal == -z){
               norm = normalize([b_x,0,b_z]);
            }             
            return [i,norm];
         }
      }
      return [-1,[]];
   }

    /*-----------------------------------------------------------------
      draw the pad
    -----------------------------------------------------------------*/

    if (LC) {
       drawController(RC, [0,1,1]);
    }

    /*-----------------------------------------------------------------
    Below is the code to move the ball and draw it
    -----------------------------------------------------------------*/

   m.identity();

   // If ball is not launched
   if (isStart == false){
      let ball = balls[0];
      let P = RC.position();
      m.save();
          m.identity();
          m.translate(P[0], P[1], P[2]);
          m.rotateQ(RC.orientation());
          m.translate(0,0,-.03);
          m.translate(0,0,0.025);
          m.scale(BALL_SIZE, BALL_SIZE, BALL_SIZE);
          drawShape(ball.shape, [1,1,1]);
      m.restore();
      
   }

   // If ball is launched, game start
   else{
    for (let n = 0 ; n < balls.length ; n++) {
       
       let ball = balls[n], P = ball.position, RP = ball.releasePosition;

       m.save();
         if (ball.velocity){
         // update ball position with time and velocity
            m.translate(RP[0], RP[1], RP[2]);
            let time = state.time - ball.StartTime;
            ball.position = [RP[0]+ball.velocity[0] * time, RP[1]+ball.velocity[1] * time, RP[2]+ball.velocity[2] * time];
            m.translate(ball.velocity[0] * time, ball.velocity[1] * time, ball.velocity[2] * time);

            // if the ball hits the boundary of the sphere scene
            if (norm(ball.position)> ROOM_SIZE-0.01 && ball.flag){
               let N = normalize(neg(ball.position));
               let v = norm(ball.velocity);
               let I = normalize(neg(ball.velocity));
               let w = 2.*dot(I, N);
               ball.StartTime=state.time;
               ball.releasePosition = ball.position.slice();
               ball.velocity = [v*(w*N[0]-I[0]), v*(w*N[1]-I[1]), v*(w*N[2]-I[2])];
               ball.flag = false;
            }
            else if (norm(ball.position)<ROOM_SIZE-0.01){
               ball.flag = true;
            }

            // if the ball hits the pad
            if (ball.touch && isTouch(ball, RC)){
               let N;
               m.save();
                  m.identity();
                  m.rotateQ(RC.orientation());
                  let t = m.value();
                  N = neg(normalize(getOriZ(t)));
               m.restore();
         
               let v = norm(ball.velocity);
               let I = normalize(neg(ball.velocity));
               let w = 2.*dot(I, N);
               ball.StartTime=state.time;
               ball.releasePosition = ball.position.slice();
               ball.velocity = [v*(w*N[0]-I[0]), v*(w*N[1]-I[1]), v*(w*N[2]-I[2])];
               ball.touch = false;
               console.log("touch!");
            }
            else if(Math.abs(ball.position[2]-RC.position()[2])>threshold){
               ball.touch = true;
            }

            // if the ball hits the bricks
            let brickP = hitBrick(ball.position);
            if(brickP[0]!=-1){     
               let N = brickP[1];
               let v = norm(ball.velocity);
               let I = normalize(neg(ball.velocity));
               let w = 2.*dot(I, N);
               ball.StartTime=state.time;
               ball.releasePosition = ball.position.slice();
               ball.velocity = [v*(w*N[0]-I[0]), v*(w*N[1]-I[1]), v*(w*N[2]-I[2])];
               bricks.splice(brickP[0],1);
            }
         }
         
         else {
            m.translate(P[0], P[1], P[2]);
         }
     
         //draw the ball
          m.rotateQ(ball.orientation);
          m.scale(...ball.scale);
	       drawShape(ball.shape, [1,1,1]);
       m.restore();
    }
   }

    //draw the brick
    for( let n  = 0; n < bricks.length ; n++){
       let pos = bricks[n].position;
       m.save();
         m.rotateY((bricks[n].angle)/2);
         m.translate(pos[0],pos[1],pos[2]);
         drawCube(m,bricks[n].color);
       m.restore();
    }

    if (state.calibrate)
       m.set(state.calibrate);

    m.translate(0, -EYE_HEIGHT, 0);
    m.rotateX(tiltAngle);
    m.rotateY(turnAngle);

    /*-----------------------------------------------------------------
    draw the boundary of the scene
    -----------------------------------------------------------------*/
    m.save();
      m.translate(0,-EYE_HEIGHT,0);
      m.rotateX(Math.PI*0.5);
      m.scale(-ROOM_SIZE,-ROOM_SIZE,-ROOM_SIZE);
      drawShape(sphere, [1,1,1],3,1);
    m.restore();

    
    

}

function onEndFrame(t, state) {

    /*-----------------------------------------------------------------

    The below two lines are necessary for making the controller handler
    logic work properly -- in particular, detecting press() and release()
    actions.

    -----------------------------------------------------------------*/

    if (LC) LC.onEndFrame();
    if (RC) RC.onEndFrame();
}

export default function main() {
    const def = {
        name         : 'week9',
        setup        : setup,
        onStartFrame : onStartFrame,
        onEndFrame   : onEndFrame,
        onDraw       : onDraw,
    };
    return def;
}

