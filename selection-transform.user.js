// ==UserScript==
// @name         Line Rider Selection Transform Mod
// @namespace    http://tampermonkey.net/
// @version      0.6.0
// @description  Adds ability to transform selections
// @author       David Lu & Ethan Li
// @match        https://www.linerider.com/*
// @match        https://*.official-linerider.com/*
// @match        http://localhost:8000/*
// @downloadURL  https://github.com/EmergentStudios/linerider-userscript-mods/raw/master/selection-transform.user.js
// @grant        none
// ==/UserScript==

// jshint asi: true
// jshint esversion: 6

/* constants */
const SELECT_TOOL = 'SELECT_TOOL'
const EMPTY_SET = new Set()
const LINE_WIDTH = 2

/* actions */
const setTool = (tool) => ({
  type: 'SET_TOOL',
  payload: tool
})

const updateLines = (linesToRemove, linesToAdd) => ({
  type: 'UPDATE_LINES',
  payload: { linesToRemove, linesToAdd }
})

const setLines = (line) => updateLines(null, line)

const commitTrackChanges = () => ({
  type: 'COMMIT_TRACK_CHANGES'
})

const revertTrackChanges = () => ({
  type: 'REVERT_TRACK_CHANGES'
})

const setEditScene = (scene) => ({
  type: 'SET_RENDERER_SCENE',
  payload: { key: 'edit', scene }
})

/* selectors */
const getActiveTool = state => state.selectedTool
const getToolState = (state, toolId) => state.toolState[toolId]
const getSelectToolState = state => getToolState(state, SELECT_TOOL)
const getSimulatorCommittedTrack = state => state.simulator.committedEngine
const getEditorZoom = state => state.camera.editorZoom

class TransformMod {
  constructor (store, initState) {
    this.store = store

    this.changed = false
    this.state = initState

    this.track = getSimulatorCommittedTrack(this.store.getState())
    this.selectedPoints = EMPTY_SET

    store.subscribeImmediate(() => {
      this.onUpdate()
    })
  }

  commit () {
    if (this.changed) {
      this.store.dispatch(commitTrackChanges())
      this.store.dispatch(revertTrackChanges())
      this.store.dispatch(setEditScene(new Millions.Scene()))
      this.changed = false
      return true
    }
  }

  onUpdate (nextState = this.state) {
    let shouldUpdate = false

    if (this.state !== nextState) {
      this.state = nextState
      shouldUpdate = true
    }

    if (this.state.active) {
      const track = getSimulatorCommittedTrack(this.store.getState())
      if (this.track !== track) {
        this.track = track
        shouldUpdate = true
      }

      const selectToolState = getSelectToolState(this.store.getState())

      let selectedPoints = selectToolState.selectedPoints

      if (!selectToolState.multi) {
        selectedPoints = EMPTY_SET
      }

      if (!setsEqual(this.selectedPoints, selectedPoints)) {
        this.selectedPoints = selectedPoints
        shouldUpdate = true
      }
    }

    if (!shouldUpdate) {
      return
    }

    if (this.changed) {
      this.store.dispatch(revertTrackChanges())
      this.store.dispatch(setEditScene(new Millions.Scene()))
      this.changed = false
    }

    if (!this.active()) {
      return
    }

    const pretransformedLines = [...getLinesFromPoints(this.selectedPoints)]
      .map(id => this.track.getLine(id))
      .filter(l => l)
    const preBB = getBoundingBox(pretransformedLines)
    const preCenter = new V2({
      x: preBB.x + 0.5 * preBB.width,
      y: preBB.y + 0.5 * preBB.height
    })

    const alongRot = this.state.alongRot * Math.PI / 180
    const preTransform = buildRotTransform(-alongRot)
    const selectedLines = []
    for (let line of pretransformedLines) {
      const p1 = preparePointAlong(
        new V2(line.p1),
        preCenter, this.state.alongPerspX, this.state.alongPerspY, preTransform
      )
      const p2 = preparePointAlong(
        new V2(line.p2),
        preCenter, this.state.alongPerspX, this.state.alongPerspY, preTransform
      )
      selectedLines.push({original: line, p1, p2})
    }
    const bb = getBoundingBox(selectedLines)
    const anchor = new V2({
      x: bb.x + (0.5 + this.state.anchorX) * bb.width,
      y: bb.y + (0.5 - this.state.anchorY) * bb.height
    })
    const nudge = new V2({
      x: this.state.nudgeXSmall + this.state.nudgeXBig,
      y: -1 * (this.state.nudgeYSmall + this.state.nudgeYBig)
    })

    const transform = this.getTransform()
    const transformedLines = []

    const alongPerspX = this.state.alongPerspX * 0.01
    const alongPerspY = this.state.alongPerspY * 0.01
    const postTransform = buildRotTransform(alongRot)
    let perspX = this.state.perspX
    let perspY = this.state.perspY
    const perspSafety = Math.pow(10, this.state.perspClamping)
    if (this.state.relativePersp) {
      let perspXDenominator = bb.width * this.state.scale * this.state.scaleX
      if (Math.abs(bb.width) < perspSafety) {
        perspXDenominator = perspSafety
      }
      perspX = perspX / perspXDenominator
      let perspYDenominator = bb.height * this.state.scale * this.state.scaleY
      if (Math.abs(perspYDenominator) < perspSafety) {
        perspYDenominator = perspSafety
      }
      perspY = perspY / perspYDenominator
    } else {
      perspX = 0.01 * perspX
      perspY = 0.01 * perspY
    }
    for (let line of selectedLines) {
      const p1 = restorePoint(
        transformPersp(
          new V2(line.p1).sub(anchor).transform(transform),
          perspX, perspY, perspSafety
        ),
        anchor, postTransform, alongPerspX, alongPerspY, preCenter,
      ).add(nudge)
      const p2 = restorePoint(
        transformPersp(
          new V2(line.p2).sub(anchor).transform(transform),
          perspX, perspY, perspSafety
        ),
        anchor, postTransform, alongPerspX, alongPerspY, preCenter,
      ).add(nudge)

      transformedLines.push({
        ...line.original.toJSON(),
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y
      })
    }
    this.store.dispatch(setLines(transformedLines))

    this.drawBoundingBoxes(
      bb, anchor, transform, postTransform, alongPerspX, alongPerspY, preCenter
    )

    this.changed = true
  }

  getTransform() {
    let scaleX = this.state.scale * this.state.scaleX
    if (this.state.flipX) {
      scaleX *= -1
    }
    let scaleY = this.state.scale * this.state.scaleY
    if (this.state.flipY) {
      scaleY *= -1
    }
    const transform = buildAffineTransform(
      this.state.skewX, this.state.skewY,
      scaleX, scaleY,
      this.state.rotate * Math.PI / 180
    )
    return transform
  }

  active() {
    return this.state.active && this.selectedPoints.size > 0 && (
      this.state.advancedTools ||
      this.state.alongPerspX !== 0 || this.state.alongPerspY !== 0 ||
      this.state.alongRot !== 0 ||
      this.state.anchorX !== 0 || this.state.anchorY !== 0 ||
      this.state.skewX !== 0 || this.state.skewY !== 0 ||
      this.state.scaleX !== 1 || this.state.scaleY !== 1 || this.state.scale !== 1 ||
      this.state.flipX || this.state.flipY ||
      this.state.rotate !== 0 ||
      this.state.perspX || this.state.perspY ||
      this.state.nudgeXSmall !== 0 || this.state.nudgeXBig !== 0 ||
      this.state.nudgeYSmall !== 0 || this.state.nudgeYBig !== 0
    )
  }

  drawBoundingBoxes(bb, anchor, transform, postTransform, alongPerspX, alongPerspY, preCenter) {
    const zoom = getEditorZoom(this.store.getState())
    const preBox = genBoundingBox(
      bb.x, bb.y, bb.x + bb.width, bb.y + bb.height,
      anchor.x, anchor.y, 20 / zoom,
      1 / zoom, new Millions.Color(0, 0, 0, 64), 0
    )
    for (let line of preBox) {
      const p1 = restorePoint(
        new V2(line.p1).sub(anchor),
        anchor, postTransform, alongPerspX, alongPerspY, preCenter,
      )
      const p2 = restorePoint(
        new V2(line.p2).sub(anchor),
        anchor, postTransform, alongPerspX, alongPerspY, preCenter,
      )
      line.p1.x = p1.x
      line.p1.y = p1.y
      line.p2.x = p2.x
      line.p2.y = p2.y
    }
    const postBox = genBoundingBox(
      bb.x, bb.y, bb.x + bb.width, bb.y + bb.height,
      anchor.x, anchor.y, 20 / zoom,
      1 / zoom, new Millions.Color(0, 0, 0, 255), 1
    )
    let perspX = this.state.perspX
    let perspY = this.state.perspY
    if (this.state.relativePersp) {
      perspX = perspX / (bb.width * this.state.scale * this.state.scaleX)
      perspY = perspY / (bb.height * this.state.scale * this.state.scaleY)
    } else {
      perspX = 0.01 * perspX
      perspY = 0.01 * perspY
    }
    const perspSafety = Math.pow(10, this.state.perspClamping)
    for (let line of postBox) {
      const p1 = restorePoint(
        transformPersp(
          new V2(line.p1).sub(anchor).transform(transform),
          perspX, perspY, perspSafety
        ),
        anchor, postTransform, alongPerspX, alongPerspY, preCenter,
      )
      const p2 = restorePoint(
        transformPersp(
          new V2(line.p2).sub(anchor).transform(transform),
          perspX, perspY, perspSafety
        ),
        anchor, postTransform, alongPerspX, alongPerspY, preCenter,
      )
      line.p1.x = p1.x
      line.p1.y = p1.y
      line.p2.x = p2.x
      line.p2.y = p2.y
    }
    const boxes = this.state.advancedTools ? [...preBox, ...postBox] : postBox
    this.store.dispatch(setEditScene(Millions.Scene.fromEntities(boxes)))
  }
}

function main () {
  const {
    React,
    store
  } = window

  const e = React.createElement

  class TransformModComponent extends React.Component {
    constructor (props) {
      super(props)

      this.defaults = {
        scale: 1,
        alongPerspX: 0,
        alongPerspY: 0,
        alongRot: 0,
        anchorX: 0,
        anchorY: 0,
        skewX: 0,
        skewY: 0,
        scaleX: 1,
        scaleY: 1,
        flipX: false,
        flipY: false,
        rotate: 0,
        perspX: 0,
        perspY: 0,
        nudgeXSmall: 0,
        nudgeXBig: 0,
        nudgeYSmall: 0,
        nudgeYBig: 0,
      }
      this.state = {
        ...this.defaults,
        active: false,
        advancedTools: false,
        warpTools: false,
        translateTools: false,
        relativePersp: true,
        perspClamping: -5,
      }

      this.transformMod = new TransformMod(store, this.state)

      store.subscribe(() => {
        const selectToolActive = getActiveTool(store.getState()) === SELECT_TOOL

        if (this.state.active && !selectToolActive) {
          this.setState({ active: false })
        }
      })
    }

    componentWillUpdate (nextProps, nextState) {
      this.transformMod.onUpdate(nextState)
    }

    onReset (key) {
      let changedState = {}
      changedState[key] = this.defaults[key]
      this.setState(changedState)
    }

    onResetAll (key) {
      this.setState({...this.defaults})
    }

    onCommit () {
      this.transformMod.commit()
      this.setState({
        ...this.defaults,
        active: false,
      })
    }

    onActivate () {
      if (this.state.active) {
        this.setState({ active: false })
      } else {
        store.dispatch(setTool(SELECT_TOOL))
        this.setState({ active: true })
      }
    }

    renderCheckbox (key, props) {
      props = {
        ...props,
        checked: this.state[key],
        onChange: e => this.setState({ [key]: e.target.checked })
      }
      return e('div', null,
        key,
        e('input', { type: 'checkbox', ...props })
      )
    }

    // TODO: is it possible to unify renderCheckbox and renderSlider into a Mod Support library?
    renderSlider (key, props) {
      props = {
        ...props,
        value: this.state[key],
        onChange: e => this.setState({ [key]: parseFloatOrDefault(e.target.value) })
      }
      // TODO: make rangeProps be an optional param which defaults to numberProps but
      // can be overridden, so that we can allow numberProps to not have min/max
      const rangeProps = {
        ...props
      }
      const numberProps = {
        ...props
      }
      return e('div', null,
        key,
        e('input', { style: { width: '4em' }, type: 'number', ...numberProps }),
        e('input', { type: 'range', ...rangeProps, onFocus: e => e.target.blur() }),
        e('button', { onClick: () => this.onReset(key) }, 'Reset')
      )
    }

    render () {
      let tools = []
      if (this.state.active) {
        if (this.state.advancedTools) {
          if (this.state.warpTools) {
            tools = [
              ...tools,
              this.renderSlider('alongPerspX', { min: -0.5, max: 0.5, step: 0.001 }),
              this.renderSlider('alongPerspY', { min: -0.5, max: 0.5, step: 0.001 }),
            ]
          }
          tools = [
            ...tools,
            this.renderSlider('alongRot', { min: -180, max: 180, step: 1 }),
            this.renderSlider('anchorX', { min: -0.5, max: 0.5, step: 0.01 }),
            this.renderSlider('anchorY', { min: -0.5, max: 0.5, step: 0.01 }),
          ]
        }
        if (this.state.warpTools) {
          tools = [
            ...tools,
            this.renderSlider('skewX', { min: -2, max: 2, step: 0.01 }),
            this.renderSlider('skewY', { min: -2, max: 2, step: 0.01 }),
          ]
        }
        tools = [
          ...tools,
          this.renderSlider('scaleX', { min: 0, max: 10, step: 0.01 }),
          this.renderSlider('scaleY', { min: 0, max: 10, step: 0.01 }),
          this.renderSlider('scale', { min: 0, max: 10, step: 0.01 }),
          this.renderCheckbox('flipX'),
          this.renderCheckbox('flipY'),
          this.renderSlider('rotate', { min: -180, max: 180, step: 1 }),
        ]
        if (this.state.warpTools) {
          if (this.state.advancedTools) {
            tools = [
              ...tools,
              this.renderCheckbox('relativePersp'),
              this.renderSlider('perspClamping', { min: -5, max: 0, step: 0.01 }),
            ]
          }
          tools = [
            ...tools,
            this.renderSlider('perspX', { min: -1, max: 1, step: 0.01 }),
            this.renderSlider('perspY', { min: -1, max: 1, step: 0.01 }),
          ]
        }
        if (this.state.translateTools) {
          tools = [
            ...tools,
            this.renderSlider('nudgeXSmall', { min: -10, max: 10, step: 0.1 }),
            this.renderSlider('nudgeXBig', { min: -2000, max: 2000, step: 10 }),
            this.renderSlider('nudgeYSmall', { min: -10, max: 10, step: 0.1 }),
            this.renderSlider('nudgeYBig', { min: -2000, max: 2000, step: 10 }),
          ]
        }
        tools = [
          ...tools,
          e('hr'),
          this.renderCheckbox('advancedTools'),
          this.renderCheckbox('warpTools'),
          this.renderCheckbox('translateTools'),
        ]
        tools = [
          ...tools,
          e('button', { style: { float: 'left' }, onClick: () => this.onCommit() }, 'Commit'),
          e('button', { style: { float: 'left' }, onClick: () => this.onResetAll() }, 'Reset'),
        ]
      }
      return e('div',
        null,
        this.state.active && e('div', null, tools),
        e('button',
          {
            style: {
              backgroundColor: this.state.active ? 'lightblue' : null
            },
            onClick: this.onActivate.bind(this)
          },
          'Transform Mod'
        )
      )
    }
  }

  // this is a setting and not a standalone tool because it extends the select tool
  window.registerCustomSetting(TransformModComponent)
}

/* init */
if (window.registerCustomSetting) {
  main()
} else {
  const prevCb = window.onCustomToolsApiReady
  window.onCustomToolsApiReady = () => {
    if (prevCb) prevCb()
    main()
  }
}

/* utils */
function setsEqual (a, b) {
  if (a === b) {
    return true
  }
  if (a.size !== b.size) {
    return false
  }
  for (let x of a) {
    if (!b.has(x)) {
      return false
    }
  }
  return true
}

function getLinesFromPoints (points) {
  return new Set([...points].map(point => point >> 1))
}

function buildAffineTransform(shearX, shearY, scaleX, scaleY, rot) {
  const { V2 } = window

  let tShear = [1 + shearX * shearY, shearX, shearY, 1, 0, 0]
  let tScale = [scaleX, 0, 0, scaleY, 0, 0]
  let u = V2.from(1, 0).rot(rot).transform(tScale).transform(tShear)
  let v = V2.from(0, 1).rot(rot).transform(tScale).transform(tShear)

  return [u.x, v.x, u.y, v.y, 0, 0]
}
function buildRotTransform(rot) {
  const { V2 } = window

  let u = V2.from(1, 0).rot(rot)
  let v = V2.from(0, 1).rot(rot)

  return [u.x, v.x, u.y, v.y, 0, 0]
}
function preparePointAlong(p, preCenter, alongPerspX, alongPerspY, preTransform) {
  return transformPersp(p.sub(preCenter), -alongPerspX, -alongPerspY, 0).transform(preTransform)
}
function transformPersp(p, perspX, perspY, epsilon) {
  const pt = new V2(p)
  let w = (1 + perspX * pt.x + perspY * pt.y)
  if (Math.abs(w) < epsilon) {
      w = Math.sign(w) * epsilon
  }
  pt.x = pt.x / w
  pt.y = pt.y / w
  return pt
}
function restorePoint(p, anchor, postTransform, alongPerspX, alongPerspY, preCenter) {
  return transformPersp(
    p.add(anchor).transform(postTransform),
    alongPerspX, alongPerspY, 0
  ).add(preCenter)
}

function parseFloatOrDefault (string, defaultValue = 0) {
  const x = parseFloat(string)
  return isNaN(x) ? defaultValue : x
}

function getBoundingBox (lines) {
  if (lines.size === 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let line of lines) {
    minX = Math.min(line.p1.x, minX)
    minY = Math.min(line.p1.y, minY)
    maxX = Math.max(line.p1.x, maxX)
    maxY = Math.max(line.p1.y, maxY)

    minX = Math.min(line.p2.x, minX)
    minY = Math.min(line.p2.y, minY)
    maxX = Math.max(line.p2.x, maxX)
    maxY = Math.max(line.p2.y, maxY)
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  }
}

function genLine (x1, y1, x2, y2, thickness, color, zIndex) {
  let p1 = {
    x: x1,
    y: y1,
    colorA: color,
    colorB: color,
    thickness
  }
  let p2 = {
    x: x2,
    y: y2,
    colorA: color,
    colorB: color,
    thickness
  }
  return new Millions.Line(p1, p2, 3, zIndex)
}


function genBoundingBox (x1, y1, x2, y2, anchorX, anchorY, anchorSize, thickness, color, zIndex) {
  return [
    // Box outline
    genLine(x1, y1, x1, y2, thickness, color, zIndex),
    genLine(x1, y2, x2, y2, thickness, color, zIndex + 0.1),
    genLine(x2, y2, x2, y1, thickness, color, zIndex + 0.2),
    genLine(x2, y1, x1, y1, thickness, color, zIndex + 0.3),
    // Transformation anchor
    genLine(anchorX, anchorY, anchorX + anchorSize, anchorY, thickness * 2, color, zIndex + 0.4),
    genLine(anchorX, anchorY, anchorX, anchorY - anchorSize, thickness * 2, color, zIndex + 0.5),
  ]
}
