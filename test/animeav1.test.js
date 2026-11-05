const test = require("node:test");
const assert = require("node:assert/strict");
const { _internals } = require("../providers/animeav1");

test("normalizes relative and absolute URLs", () => {
  assert.equal(
    _internals.absoluteUrl("/media/one"),
    "https://animeav1.com/media/one"
  );
  assert.equal(
    _internals.absoluteUrl("https://cdn.example/video.m3u8"),
    "https://cdn.example/video.m3u8"
  );
});

test("accepts only direct HTTPS HLS URLs", () => {
  assert.equal(_internals.isDirectHls("https://cdn.example/video.m3u8"), true);
  assert.equal(_internals.isDirectHls("https://cdn.example/video.m3u"), true);
  assert.equal(_internals.isDirectHls("http://cdn.example/video.m3u8"), false);
  assert.equal(_internals.isDirectHls("https://player.example/embed/123"), false);
});

test("extracts episode numbers from indexed Svelte data", () => {
  const payload = {
    nodes: [{
      data: [
        { episodes: 1 },
        [2, 3],
        { number: 4 },
        { number: 5 },
        1,
        12
      ]
    }]
  };
  assert.deepEqual(_internals.extractEpisodeNumbers(payload), [1, 12]);
});

test("does not treat a numeric TMDB id as a title", () => {
  assert.equal(_internals.getSearchTitle("123456", null), "");
  assert.equal(_internals.getSearchTitle("Naruto", null), "Naruto");
  assert.equal(_internals.getSearchTitle("123456", { title: "Naruto" }), "Naruto");
});
