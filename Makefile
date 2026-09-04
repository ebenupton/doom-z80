# DOOM E1M1 for the 128K ZX Spectrum.
#
#   make            build everything into build/
#   make test       assembler unit tests + the 200-frame reference comparison
#   make run        boot the engine headless and save a screenshot
#   make profile    per-routine T-state breakdown of a frame

NODE  ?= node
PY    ?= python3
BUILD  = build

.PHONY: all data engine tap snapshot test run profile clean

all: snapshot tap

$(BUILD)/bank0.bin: tools/pack.py tools/ref.py data/DOOM1.WAD
	$(PY) tools/pack.py
	cp $(BUILD)/start.inc src/start.inc

data: $(BUILD)/bank0.bin

engine: data
	$(NODE) tools/zbuild.js asm src/main.z80 -o $(BUILD)/doom.bin

snapshot: data
	$(NODE) tools/mkz80.js

tap: data
	$(NODE) tools/mktap.js

test: data
	$(PY) tools/genvec.py
	NFRAMES=200 $(PY) tools/genframes.py
	$(NODE) test/math.test.js
	$(NODE) test/raster.test.js
	$(NODE) test/view.test.js
	$(NODE) test/frame.test.js

run: data
	$(NODE) tools/run.js --frames 6 --png $(BUILD)/screenshot.png

profile: data
	$(NODE) tools/profile.js

clean:
	rm -f $(BUILD)/*.bin $(BUILD)/*.lst $(BUILD)/*.sym $(BUILD)/*.z80 $(BUILD)/*.tap
