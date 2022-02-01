// ==UserScript==
// @name         Line Rider Dot & Line Tool
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Adds tool to create dots and lines
// @author       Ethan Li
// @match        https://www.linerider.com/*
// @match        https://*.official-linerider.com/*
// @match        http://localhost:8000/*
// @grant        none
// @require      https://github.com/EmergentStudios/linerider-userscript-mods/raw/master/dot-line-tool.user.js
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

function parseFloatOrDefault (string, defaultValue = 0) {
  const x = parseFloat(string)
  return isNaN(x) ? defaultValue : x
}

function parseIntOrDefault (string, defaultValue = 0) {
  const x = parseInt(string)
  return isNaN(x) ? defaultValue : x
}

const TOOL_ID = "Dot & Line Tool";

const commitTrackChanges = () => ({
  type: "COMMIT_TRACK_CHANGES"
});

const getPlayerRunning = state => state.player.running;

function main() {
  const { DefaultTool, React, store, V2 } = window;

  class DotLineTool extends DefaultTool {
    dispatch(a) {
      super.dispatch(a);
    }
    getState() {
      return super.getState();
    }
    /** @return {V2} */
    toTrackPos(p) {
      return super.toTrackPos(p);
    }

    static getCursor(state) {
      return getPlayerRunning(state) ? "inherit" : "crosshair";
    }

    onPointerUp(e) {
      if (e === undefined || e.pos === undefined) {
        return;
      }
      const pos = this.toTrackPos(e.pos);
      const {dotMode, lengthSmall, lengthLarge, angle} = window.dotLineToolState;
      let length = lengthSmall + lengthLarge;
      if (dotMode) {
          length = 0;
      }
      const epsilon = 0.00000001;
      length = Math.max(length, epsilon);
      const angleRad = angle * Math.PI / 180;
      window.addLine(
        pos.x - 0.5 * length * Math.cos(angleRad),
        pos.y + 0.5 * length * Math.sin(angleRad),
        pos.x + 0.5 * length * Math.cos(angleRad),
        pos.y - 0.5 * length * Math.sin(angleRad),
      );
      store.dispatch(commitTrackChanges());
    }
  }

  const e = React.createElement;

  class DotLineComponent extends React.Component {
    constructor(props) {
      super(props);

      if (!this.setState) {
        this.setState = this.setState;
      }

      this.state = {
        dotMode: false,
        lengthSmall: 1,
        lengthLarge: 0,
        angle: 0,
      };
      window.dotLineToolState = this.state;
    }

    render() {
      const onDotModeChange = e => {
        const dotMode = e.target.checked;
        this.setState({ dotMode });
        window.dotLineToolState.dotMode = dotMode;
      }
      const onLengthSmallChange = e => {
        const lengthSmall = parseFloatOrDefault(e.target.value);
        this.setState({ lengthSmall });
        window.dotLineToolState.lengthSmall = lengthSmall;
      }
      const onLengthLargeChange = e => {
        const lengthLarge = parseIntOrDefault(e.target.value);
        this.setState({ lengthLarge });
        window.dotLineToolState.lengthLarge = lengthLarge;
      }
      const onAngleChange = e => {
        const angle = parseFloatOrDefault(e.target.value);
        this.setState({ angle });
        window.dotLineToolState.angle = angle;
      }
      let fields = [
        e("div", null, [
          e('div', null,
            'Dot Mode',
            e('input', { type: 'checkbox', onChange: onDotModeChange, checked: this.state.dotMode }),
          ),
        ]),
      ];
      if (!this.state.dotMode) {
        fields = [
          ...fields,
          e('div', null,
            'Length (small)',
            e('input', { style: { width: '4em' }, type: 'number', onChange: onLengthSmallChange, min: 0, value: this.state.lengthSmall, step: 0.1 }),
            e('input', { type: 'range', onChange: onLengthSmallChange, onFocus: e => e.target.blur(), min: 0, max: 10, step: 0.1, value: this.state.lengthSmall })
          ),
          e('div', null,
            'Length (large)',
            e('input', { style: { width: '4em' }, type: 'number', onChange: onLengthLargeChange, min: 0, value: this.state.lengthLarge, step: 10 }),
            e('input', { type: 'range', onChange: onLengthLargeChange, onFocus: e => e.target.blur(), min: 0, max: 2000, step: 10, value: this.state.lengthLarge })
          ),
          e("div", null, [
            e('div', null,
              'Angle',
              e('input', { style: { width: '4em' }, type: 'number', onChange: onAngleChange, min: -180, max: 180, value: this.state.angle, step: 1 }),
              e('input', { type: 'range', onChange: onAngleChange, onFocus: e => e.target.blur(), min: -180, max: 180, step: 1, value: this.state.angle })
            ),
          ]),
        ];
      }
      return e("div", null, ["Dot & Line Tool", ...fields]);
    }
  }

  window.registerCustomTool(TOOL_ID, DotLineTool, DotLineComponent);
}

/* init */
if (window.registerCustomTool) {
  main();
} else {
  const prevCb = window.onCustomToolsApiReady;
  window.onCustomToolsApiReady = () => {
    if (prevCb) prevCb();
    main();
  };
}
