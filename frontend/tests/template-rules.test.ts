import { test } from "node:test";
import assert from "node:assert/strict";
import { templatesForEntity,blocksForEntity,type DynamicDefinitions } from "../src/lib/definitions";

const definitions = {
  fields:{form:{applicable_kinds:["work"]},duration:{applicable_kinds:["work"]},tags:{applicable_kinds:["work"]}},
  templates:{
    legacy:{kinds:["work"],sections:[{fields:["duration"]}]},
    generic:{kinds:["work"],match:[],priority:0,sections:[]},
    song:{kinds:["work"],match:[{field:"form",operator:"equals",value:"song"}],priority:10,sections:[],blocks:["relations","directory"]},
    live:{kinds:["work"],match:[{field:"form",operator:"equals",value:"song"},{field:"tags",operator:"contains",value:"live"}],priority:20,sections:[]},
  },
} as unknown as DynamicDefinitions;

test("explicit predicates outrank filled-field guesses and combine with AND",()=>{
  assert.equal(templatesForEntity(definitions,"work",{form:"song",duration:180})[0],definitions.templates.song);
  assert.equal(templatesForEntity(definitions,"work",{form:"song",tags:["live"]})[0],definitions.templates.live);
  assert.equal(templatesForEntity(definitions,"work",{form:"novel",tags:["live"]})[0],definitions.templates.generic);
  assert.deepEqual(templatesForEntity(definitions,"agent",{form:"song"}),[]);
});
test("ties use generic facts and explicit blocks preserve order including empty choices",()=>{
  const copy=structuredClone(definitions);copy.templates.live.priority=10;
  assert.deepEqual(templatesForEntity(copy,"work",{form:"song",tags:["live"]}),[]);
  assert.deepEqual(blocksForEntity(definitions,"work",{form:"song"}),["relations","directory"]);
  copy.templates.song.blocks=[];
  assert.deepEqual(blocksForEntity(copy,"work",{form:"song"}),[]);
});
test("unconfigured old templates keep existing behavior",()=>{
  const copy=structuredClone(definitions);delete copy.templates.generic;delete copy.templates.song;delete copy.templates.live;
  assert.equal(templatesForEntity(copy,"work",{duration:180})[0],copy.templates.legacy);
  assert.deepEqual(templatesForEntity(copy,"work",{}),[]);
});
