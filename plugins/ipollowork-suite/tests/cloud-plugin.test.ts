import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as cloud from '../src/host/cloud/index.ts';

test('cloud project availability exists only while its optional plugin is enabled',async()=>{
 const ctx=new Context();
 const fiber=ctx.plugin(cloud);await fiber;
 assert(ctx.get('ipolloCloud'));
 await fiber.dispose();
 assert.equal(ctx.get('ipolloCloud'),undefined);
 await ctx.fiber.dispose();
});
