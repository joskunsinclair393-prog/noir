import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechController, spokenText, chooseVoice, speechChunks, clampVoicePosition } from '../voice-speech.js';
function setup() {
 const states=[],texts=[],utterances=[]; let mic,aborted=0,cancelled=0;
 class Recognition { constructor(){mic=this;} start(){this.onstart?.();} abort(){aborted++;} }
 class Utterance {constructor(text){this.text=text;} }
 const host={SpeechRecognition:Recognition,SpeechSynthesisUtterance:Utterance,navigator:{language:'en-AU'},speechSynthesis:{getVoices:()=>[{voiceURI:'local',localService:true}],cancel(){cancelled++;},speak(item){utterances.push(item);}}};
 const controller=createSpeechController(host,{onState:(...args)=>states.push(args),onTranscript:text=>texts.push(text)});
 return {controller,host,states,texts,utterances,get mic(){return mic;},get aborted(){return aborted;},get cancelled(){return cancelled;}};
}
test('microphone is idle until explicit start and transcripts remain text only',()=>{
 const t=setup();assert.equal(t.mic,undefined);assert.equal(t.states.length,0);
 t.controller.listen();assert.equal(t.states.at(-1)[0],'listening');assert.equal(t.mic.lang,'en-AU');
 t.mic.onresult({results:[[{transcript:'Hello NOIR'}]]});assert.deepEqual(t.texts,['Hello NOIR']);
 t.controller.stop();assert.equal(t.aborted,1);assert.equal(t.mic.onresult,null);assert.equal(t.states.at(-1)[0],'idle');
});
test('denied, missing, network and unsupported recognition fail gracefully',()=>{
 for(const error of ['not-allowed','audio-capture','network','no-speech']){const t=setup();t.controller.listen();t.mic.onerror({error});assert.equal(t.states.at(-1)[0],'error');assert.equal(t.aborted,1);}
 const states=[];const c=createSpeechController({}, {onState:(...s)=>states.push(s)});c.listen();assert.equal(c.supported,false);assert.match(states.at(-1)[1],/unavailable/);c.speak('Hello');assert.match(states.at(-1)[1],/unavailable/);
});
test('spoken replies select actual browser voices, stop listening and cancel pending speech',()=>{
 const t=setup();t.controller.listen();t.controller.speak('One sentence. Another sentence.','local');assert.equal(t.aborted,1);assert.equal(t.utterances[0].voice.voiceURI,'local');assert.equal(t.states.at(-1)[0],'speaking');
 const lateEnd=t.utterances[0].onend;t.controller.stop();lateEnd();assert.equal(t.utterances.length,1);assert.equal(t.states.at(-1)[0],'idle');assert.ok(t.cancelled>=2);
});
test('speech omits executable code, diagram JSON and markup and bounds output',()=>{
 assert.equal(spokenText('Hello [NOIR](https://example.com). ```noir-viz\n{"secret":"skip"}\n```').includes('secret'),false);
 assert.ok(spokenText('a'.repeat(20000)).length<=12000);
});

test('speech finalization produces one real turn and mute never submits an aborted turn',()=>{
 const turns=[];let mic;
 class Recognition{constructor(){mic=this;}start(){}abort(){}}
 const c=createSpeechController({SpeechRecognition:Recognition},{onTurn:text=>turns.push(text)});
 c.listen();mic.onresult({results:[[{transcript:'A complete thought'}]]});mic.onend();assert.deepEqual(turns,['A complete thought']);
 c.listen();mic.onresult({results:[[{transcript:'Do not submit this'}]]});c.stopListening();assert.equal(mic.onend,null);assert.equal(turns.length,1);
});

test('best available voice prefers enhanced voices in the user language and honors explicit selection',()=>{
 const voices=[{voiceURI:'novelty',name:'Bad News',lang:'en-US',default:true},{voiceURI:'basic',name:'Karen',lang:'en-AU'},{voiceURI:'enhanced',name:'Samantha Enhanced',lang:'en-US'},{voiceURI:'other',name:'Natural',lang:'de-DE'}];
 assert.equal(chooseVoice(voices,'','en-AU').voiceURI,'enhanced');assert.equal(chooseVoice(voices,'basic','en-AU').voiceURI,'basic');assert.equal(chooseVoice([],null),undefined);
});
test('speech retains sentence flow while bubble positions stay within small screens',()=>{
 assert.deepEqual(speechChunks('One sentence. Another sentence.'),['One sentence. Another sentence.']);
 const p=clampVoicePosition(900,900,390,600);assert.ok(p.x<=314);assert.ok(p.y<=504);assert.deepEqual(clampVoicePosition(-200,NaN,390,600),{x:12,y:12});
});
