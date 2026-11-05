const test = require("node:test");
const assert = require("node:assert/strict");
const animebum = require("../providers/animebum")._internals;
const flixlatam = require("../providers/flixlatam")._internals;

test("AnimeBum only accepts direct HTTPS HLS", () => {
  assert.equal(animebum.isHls("https://cdn.example/video.m3u8"), true);
  assert.equal(animebum.isHls("http://cdn.example/video.m3u8"), false);
  assert.equal(animebum.isHls("https://player.example/embed/1"), false);
});
test("AnimeBum resolves relative paths", () => {
  assert.equal(animebum.absoluteUrl("/serie/naruto"), "https://www.animebum.net/serie/naruto");
});
test("FlixLatam only accepts direct HTTPS HLS", () => {
  assert.equal(flixlatam.isHls("https://cdn.example/video.m3u"), true);
  assert.equal(flixlatam.isHls("https://player.example/embed/1"), false);
});
test("FlixLatam resolves relative paths", () => {
  assert.equal(flixlatam.absoluteUrl("/pelicula/example"), "https://flixlatam.com/pelicula/example");
});
