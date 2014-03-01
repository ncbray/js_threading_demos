test("Buffer get set", function() {
  var img = new fluid.Buffer(4, 2);
  equal(img.width, 4);
  equal(img.height, 2);

  img.set(2, 1, 1.5);

  equal(img.get(0, 0), 0);
  equal(img.get(1, 1), 0);
  equal(img.get(2, 1), 1.5);

  equal(img.get(-2, 1), 1.5);
  equal(img.get(2, -1), 1.5);
  equal(img.get(-2, -1), 1.5);

  equal(img.get(6, 1), 1.5);
  equal(img.get(2, 3), 1.5);
  equal(img.get(6, 3), 1.5);

  equal(img.get(6, 2), 0);
});

test("Jacobi", function() {
  var inp = new fluid.Buffer(4, 4);
  inp.set(1, 1, 1);
  inp.set(1, 3, -1);

  var fb = new fluid.Buffer(4, 4);
  var out = new fluid.Buffer(4, 4);

  fluid.jacobi(inp, fb, out, {a: 10, invB: 0.1, iterations: 30});

  var exp = new fluid.Buffer(4, 4);
  exp.set(0, 1, 0.1041666716337204);
  exp.set(1, 1, 1.0208333730697632);
  exp.set(2, 1, 0.1041666716337204);
  exp.set(3, 1, 0.02083333395421505);

  exp.set(0, 3, -0.1041666716337204);
  exp.set(1, 3, -1.0208333730697632);
  exp.set(2, 3, -0.1041666716337204);
  exp.set(3, 3, -0.02083333395421505);

  deepEqual(out.data, exp.data);


  var maxErr = 0;
  for (var i=0; i < out.data.length; i++) {
    var err = Math.abs(out.data[i] - exp.data[i]);
    maxErr = Math.max(maxErr, err);
  }

  equal(maxErr, 0);
});

module("Sharding Policy");

test("Shard 1", function() {
  var policy = new fluid.TorusShardingPolicy(256, 256, 30, 1);
  equal(policy.gridW, 1);
  equal(policy.gridH, 1);
  equal(policy.shardW, 256);
  equal(policy.shardH, 256);
  equal(policy.bufferW, 256);
  equal(policy.bufferH, 256);
  equal(policy.computeRatio, 1);
});

test("Shard 4", function() {
  var policy = new fluid.TorusShardingPolicy(256, 256, 30, 4);
  equal(policy.gridW, 2);
  equal(policy.gridH, 2);
  equal(policy.shardW, 128);
  equal(policy.shardH, 128);
  equal(policy.bufferW, 188);
  equal(policy.bufferH, 188);
  equal(policy.computeRatio, 2.1572265625);

  equal(policy.shardX(0), 0);
  equal(policy.shardY(0), 0);

  equal(policy.shardX(1), 128);
  equal(policy.shardY(1), 0);

  equal(policy.shardX(2), 0);
  equal(policy.shardY(2), 128);

  equal(policy.shardX(3), 128);
  equal(policy.shardY(3), 128);
});

test("Shard 16", function() {
  var policy = new fluid.TorusShardingPolicy(256, 256, 30, 8);
  equal(policy.gridW, 2);
  equal(policy.gridH, 4);
  equal(policy.shardW, 128);
  equal(policy.shardH, 64);
  equal(policy.bufferW, 188);
  equal(policy.bufferH, 124);
  equal(policy.computeRatio, 2.845703125);


  equal(policy.shardX(0), 0);
  equal(policy.shardY(0), 0);

  equal(policy.shardX(1), 128);
  equal(policy.shardY(1), 0);

  equal(policy.shardX(2), 0);
  equal(policy.shardY(2), 64);

  equal(policy.shardX(3), 128);
  equal(policy.shardY(3), 64);

  equal(policy.shardX(4), 0);
  equal(policy.shardY(4), 128);

  equal(policy.shardX(5), 128);
  equal(policy.shardY(5), 128);


  equal(policy.bufferX(3), 128 - 30);
  equal(policy.bufferY(3), 64 - 30);
});

test("Sharded Jacobi", function() {
  var inp = new fluid.Buffer(4, 4);

  inp.set(1, 1, 1);
  inp.set(1, 3, -1);

  var fb = new fluid.Buffer(4, 4);
  var out = new fluid.Buffer(4, 4);
  var params = {a: 10, invB: 0.1, iterations: 4};
  fluid.jacobi(inp, fb, out, params);


  var policy = new fluid.TorusShardingPolicy(4, 4, params.iterations - 1, 16);
  var sout = new fluid.Buffer(4, 4);

  for (var i = 0; i < policy.shards; i++) {
    var tfb = new fluid.Buffer(4, 4);
    var buf = new fluid.Buffer(4, 4);
    fluid.jacobiRegion(inp, tfb, buf, params, policy.bufferX(i), policy.bufferY(i), policy.bufferW, policy.bufferH);
    policy.gatherShardOutput(i, buf, sout);
  }

  var exp = new fluid.Buffer(4, 4);
  exp.set(0, 1, 0.1);
  exp.set(1, 1, 1);
  exp.set(2, 1, 0.1);

  exp.set(0, 3, -0.1);
  exp.set(1, 3, -1.0);
  exp.set(2, 3, -0.1);

  deepEqual(sout.data, out.data);
});