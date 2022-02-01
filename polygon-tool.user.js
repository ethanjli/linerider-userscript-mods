// ==UserScript==
// @name         Line Rider Polygon Tool
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  Adds tool to create circles and polygons
// @author       Ethan Li
// @match        https://www.linerider.com/*
// @match        https://*.official-linerider.com/*
// @match        http://localhost:8000/*
// @grant        none
// @require      https://github.com/EmergentStudios/linerider-userscript-mods/raw/master/polygon-tool.user.js
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

const TOOL_ID = "Polygon Tool";

const commitTrackChanges = () => ({
  type: "COMMIT_TRACK_CHANGES"
});

const getPlayerRunning = state => state.player.running;

function main() {
  const { DefaultTool, React, store, V2 } = window;

  class PolygonTool extends DefaultTool {
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
      const {sidesSmall, sidesLarge, sizeSmall, sizeLarge} = window.polygonToolState;
      window.addCircle(sizeSmall + sizeLarge, sidesSmall + sidesLarge, pos.x, pos.y);
      store.dispatch(commitTrackChanges());
    }
  }

  const e = React.createElement;

  class PolygonComponent extends React.Component {
    constructor(props) {
      super(props);

      if (!this.setState) {
        this.setState = this.setState;
      }

      this.state = {
        sidesSmall: 3,
        sidesLarge: 0,
        sizeSmall: 20,
        sizeLarge: 0,
      };
      window.polygonToolState = this.state;
    }

    render() {
      const onSidesSmallChange = e => {
        const sidesSmall = parseIntOrDefault(e.target.value);
        this.setState({ sidesSmall });
        window.polygonToolState.sidesSmall = sidesSmall;
      }
      const onSidesLargeChange = e => {
        const sidesLarge = parseIntOrDefault(e.target.value);
        this.setState({ sidesLarge });
        window.polygonToolState.sidesLarge = sidesLarge;
      }
      const onSizeSmallChange = e => {
        const sizeSmall = parseFloatOrDefault(e.target.value);
        this.setState({ sizeSmall });
        window.polygonToolState.sizeSmall = sizeSmall;
      }
      const onSizeLargeChange = e => {
        const sizeLarge = parseFloatOrDefault(e.target.value);
        this.setState({ sizeLarge });
        window.polygonToolState.sizeLarge = sizeLarge;
      }
      return e("div", null, [
        "Polygon Tool",
        e('div', null,
          'Sides (small)',
          e('input', { style: { width: '4em' }, type: 'number', onChange: onSidesSmallChange, min: 3, value: this.state.sidesSmall, step: 1 }),
          e('input', { type: 'range', onChange: onSidesSmallChange, onFocus: e => e.target.blur(), min: 3, max: 10, step: 1, value: this.state.sidesSmall })
        ),
        e('div', null,
          'Sides (large)',
          e('input', { style: { width: '4em' }, type: 'number', onChange: onSidesLargeChange, min: 0, value: this.state.sidesLarge, step: 10 }),
          e('input', { type: 'range', onChange: onSidesLargeChange, onFocus: e => e.target.blur(), min: 0, max: 500, step: 10, value: this.state.sidesLarge })
        ),
        e("div", null, [
          e('div', null,
            'Size (small)',
            e('input', { style: { width: '4em' }, type: 'number', onChange: onSizeSmallChange, min: 0, value: this.state.sizeSmall, step: 1 }),
            e('input', { type: 'range', onChange: onSizeSmallChange, onFocus: e => e.target.blur(), min: 0, max: 100, step: 1, value: this.state.sizeSmall })
          ),
        ]),
        e("div", null, [
          e('div', null,
            'Size (large)',
            e('input', { style: { width: '4em' }, type: 'number', onChange: onSizeLargeChange, min: 0, value: this.state.sizeLarge, step: 100 }),
            e('input', { type: 'range', onChange: onSizeLargeChange, onFocus: e => e.target.blur(), min: 0, max: 1000, step: 100, value: this.state.sizeLarge })
          ),
        ]),
      ]);
    }
  }

  window.registerCustomTool(TOOL_ID, PolygonTool, PolygonComponent);
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
