import filter from 'lodash/filter';
import first from 'lodash/first';
import sortBy from 'lodash/sortBy';
import findKey from 'lodash/findKey';
import forEach from 'lodash/forEach';
import forOwn from 'lodash/forOwn';
import difference from 'lodash/difference';
import measureLayout from './measureLayout';
import VisualDebugger from './visualDebugger';

export const ROOT_FOCUS_KEY = 'SN:ROOT';

const ADJACENT_SLICE_THRESHOLD = 0.2;

/**
 * Adjacent slice is 5 times more important than diagonal
 */
const ADJACENT_SLICE_WEIGHT = 5;
const DIAGONAL_SLICE_WEIGHT = 1;

/**
 * Main coordinate distance is 5 times more important
 */
const MAIN_COORDINATE_WEIGHT = 5;

const DIRECTION_LEFT = 'left';
const DIRECTION_RIGHT = 'right';
const DIRECTION_UP = 'up';
const DIRECTION_DOWN = 'down';
const KEY_ENTER = 'enter';

const DEFAULT_KEY_MAP = {
  [DIRECTION_LEFT]: 37,
  [DIRECTION_UP]: 38,
  [DIRECTION_RIGHT]: 39,
  [DIRECTION_DOWN]: 40,
  [KEY_ENTER]: 13
};

const DEBUG_FN_COLORS = ['#0FF', '#FF0', '#F0F'];

/* eslint-disable no-nested-ternary */
class SpatialNavigation {
  /**
   * Used to determine the coordinate that will be used to filter items that are over the "edge"
   */
  static getCutoffCoordinate(isVertical, isIncremental, isSibling, layout) {
    const itemX = layout.left;
    const itemY = layout.top;
    const itemWidth = layout.width;
    const itemHeight = layout.height;

    const coordinate = isVertical ? itemY : itemX;
    const itemSize = isVertical ? itemHeight : itemWidth;

    return isIncremental ?
      (isSibling ? coordinate : coordinate + itemSize) :
      (isSibling ? coordinate + itemSize : coordinate);
  }

  /**
   * Returns two corners (a and b) coordinates that are used as a reference points
   * Where "a" is always leftmost and topmost corner, and "b" is rightmost bottommost corner
   */
  static getRefCorners(direction, isSibling, layout) {
    const itemX = layout.left;
    const itemY = layout.top;
    const itemWidth = layout.width;
    const itemHeight = layout.height;

    const result = {
      a: {
        x: 0,
        y: 0
      },
      b: {
        x: 0,
        y: 0
      }
    };

    switch (direction) {
    case DIRECTION_UP: {
      const y = isSibling ? itemY + itemHeight : itemY;

      result.a = {
        x: itemX,
        y
      };

      result.b = {
        x: itemX + itemWidth,
        y
      };

      break;
    }

    case DIRECTION_DOWN: {
      const y = isSibling ? itemY : itemY + itemHeight;

      result.a = {
        x: itemX,
        y
      };

      result.b = {
        x: itemX + itemWidth,
        y
      };

      break;
    }

    case DIRECTION_LEFT: {
      const x = isSibling ? itemX + itemWidth : itemX;

      result.a = {
        x,
        y: itemY
      };

      result.b = {
        x,
        y: itemY + itemHeight
      };

      break;
    }

    case DIRECTION_RIGHT: {
      const x = isSibling ? itemX : itemX + itemWidth;

      result.a = {
        x,
        y: itemY
      };

      result.b = {
        x,
        y: itemY + itemHeight
      };

      break;
    }

    default:
      break;
    }

    return result;
  }

  /**
   * Calculates if the sibling node is intersecting enough with the ref node by the secondary coordinate
   */
  static isAdjacentSlice(refCorners, siblingCorners, isVerticalDirection) {
    const {a: refA, b: refB} = refCorners;
    const {a: siblingA, b: siblingB} = siblingCorners;
    const coordinate = isVerticalDirection ? 'x' : 'y';

    const refCoordinateA = refA[coordinate];
    const refCoordinateB = refB[coordinate];
    const siblingCoordinateA = siblingA[coordinate];
    const siblingCoordinateB = siblingB[coordinate];

    const thresholdDistance = (refCoordinateB - refCoordinateA) * ADJACENT_SLICE_THRESHOLD;

    const intersectionLength = Math.max(0, Math.min(refCoordinateB, siblingCoordinateB) -
      Math.max(refCoordinateA, siblingCoordinateA));

    return intersectionLength >= thresholdDistance;
  }

  static getPrimaryAxisDistance(refCorners, siblingCorners, isVerticalDirection) {
    const {a: refA} = refCorners;
    const {a: siblingA} = siblingCorners;
    const coordinate = isVerticalDirection ? 'y' : 'x';

    return Math.abs(siblingA[coordinate] - refA[coordinate]);
  }

  static getSecondaryAxisDistance(refCorners, siblingCorners, isVerticalDirection) {
    const {a: refA, b: refB} = refCorners;
    const {a: siblingA, b: siblingB} = siblingCorners;
    const coordinate = isVerticalDirection ? 'x' : 'y';

    const refCoordinateA = refA[coordinate];
    const refCoordinateB = refB[coordinate];
    const siblingCoordinateA = siblingA[coordinate];
    const siblingCoordinateB = siblingB[coordinate];

    const distancesToCompare = [];

    distancesToCompare.push(Math.abs(siblingCoordinateA - refCoordinateA));
    distancesToCompare.push(Math.abs(siblingCoordinateA - refCoordinateB));
    distancesToCompare.push(Math.abs(siblingCoordinateB - refCoordinateA));
    distancesToCompare.push(Math.abs(siblingCoordinateB - refCoordinateB));

    return Math.min(...distancesToCompare);
  }

  /**
   * Inspired by: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox_OS_for_TV/TV_remote_control_navigation#Algorithm_design
   * Ref Corners are the 2 corners of the current component in the direction of navigation
   * They used as a base to measure adjacent slices
   */
  sortSiblingsByPriority(siblings, currentLayout, direction, focusKey) {
    const isVerticalDirection = direction === DIRECTION_DOWN || direction === DIRECTION_UP;

    const refCorners = SpatialNavigation.getRefCorners(direction, false, currentLayout);

    return sortBy(siblings, (sibling) => {
      const siblingCorners = SpatialNavigation.getRefCorners(direction, true, sibling.layout);

      const isAdjacentSlice = SpatialNavigation.isAdjacentSlice(refCorners, siblingCorners, isVerticalDirection);

      const primaryAxisFunction = isAdjacentSlice ?
        SpatialNavigation.getPrimaryAxisDistance :
        SpatialNavigation.getSecondaryAxisDistance;

      const secondaryAxisFunction = isAdjacentSlice ?
        SpatialNavigation.getSecondaryAxisDistance :
        SpatialNavigation.getPrimaryAxisDistance;

      const primaryAxisDistance = primaryAxisFunction(refCorners, siblingCorners, isVerticalDirection);
      const secondaryAxisDistance = secondaryAxisFunction(refCorners, siblingCorners, isVerticalDirection);

      /**
       * The higher this value is, the less prioritised the candidate is
       */
      const totalDistancePoints = (primaryAxisDistance * MAIN_COORDINATE_WEIGHT) + secondaryAxisDistance;

      /**
       * + 1 here is in case of distance is zero, but we still want to apply Adjacent priority weight
       */
      const priority = (totalDistancePoints + 1) / (isAdjacentSlice ? ADJACENT_SLICE_WEIGHT : DIAGONAL_SLICE_WEIGHT);

      this.log(
        'smartNavigate',
        `distance (primary, secondary, total weighted) for ${sibling.focusKey} relative to ${focusKey} is`,
        primaryAxisDistance,
        secondaryAxisDistance,
        totalDistancePoints
      );

      this.log(
        'smartNavigate',
        `priority for ${sibling.focusKey} relative to ${focusKey} is`,
        priority
      );

      if (this.visualDebugger) {
        this.visualDebugger.drawPoint(siblingCorners.a.x, siblingCorners.a.y, 'yellow', 6);
        this.visualDebugger.drawPoint(siblingCorners.b.x, siblingCorners.b.y, 'yellow', 6);
      }

      return priority;
    });
  }

  constructor() {
    /**
     * Storage for all focusable components
     */
    this.focusableComponents = {};

    /**
     * Storing current focused key
     */
    this.focusKey = null;

    /**
     * This collection contains focus keys of the elements that are having a child focused
     * Might be handy for styling of certain parent components if their child is focused.
     */
    this.parentsHavingFocusedChild = [];

    this.enabled = false;

    /**
     * Flag used to block key events from this service
     * @type {boolean}
     */
    this.paused = false;

    this.keyEventListener = null;
    this.keyMap = DEFAULT_KEY_MAP;

    this.onKeyEvent = this.onKeyEvent.bind(this);
    this.pause = this.pause.bind(this);
    this.resume = this.resume.bind(this);
    this.setFocus = this.setFocus.bind(this);
    this.init = this.init.bind(this);
    this.setKeyMap = this.setKeyMap.bind(this);

    this.debug = false;
    this.visualDebugger = null;

    this.logIndex = 0;
  }

  init({
    debug: debug = false,
    visualDebug: visualDebug = false
  } = {}) {
    if (!this.enabled) {
      this.enabled = true;
      this.bindEventHandlers();
      this.debug = debug;
      if (visualDebug) {
        this.visualDebugger = new VisualDebugger();
        this.startDrawLayouts();
      }
    }
  }

  startDrawLayouts() {
    const draw = () => {
      requestAnimationFrame(() => {
        this.visualDebugger.clearLayouts();
        forOwn(this.focusableComponents, (component, focusKey) => {
          this.visualDebugger.drawLayout(
            component.layout,
            focusKey,
            component.parentFocusKey
          );
        });
        draw();
      });
    };

    draw();
  }

  destroy() {
    if (this.enabled) {
      this.enabled = false;
      this.focusKey = null;
      this.parentsHavingFocusedChild = [];
      this.focusableComponents = {};
      this.paused = false;
      this.keyMap = DEFAULT_KEY_MAP;

      this.unbindEventHandlers();
    }
  }

  bindEventHandlers() {
    if (window) {
      this.keyEventListener = (event) => {
        if (this.paused === true) {
          return;
        }

        this.logIndex++;

        const eventType = findKey(this.getKeyMap(), (code) => event.keyCode === code);

        if (!eventType) {
          return;
        }

        if (eventType === KEY_ENTER && this.focusKey) {
          event.preventDefault();
          event.stopPropagation();

          this.onEnterPress();
        } else {
          event.preventDefault();
          event.stopPropagation();

          this.onKeyEvent(event.keyCode);
        }
      };

      window.addEventListener('keydown', this.keyEventListener);
    }
  }

  unbindEventHandlers() {
    if (window) {
      window.removeEventListener('keydown', this.keyEventListener);
      this.keyEventListener = null;
    }
  }

  onEnterPress() {
    const component = this.focusableComponents[this.focusKey];

    component.onEnterPressHandler && component.onEnterPressHandler();
  }

  onKeyEvent(keyCode) {
    this.visualDebugger && this.visualDebugger.clear();

    const direction = findKey(this.getKeyMap(), (code) => keyCode === code);

    this.smartNavigate(direction);
  }

  /**
   * This function navigates between siblings OR goes up by the Tree
   * Based on the Direction
   */
  smartNavigate(direction, fromParentFocusKey) {
    this.log('smartNavigate', 'direction', direction);
    this.log('smartNavigate', 'fromParentFocusKey', fromParentFocusKey);
    this.log('smartNavigate', 'this.focusKey', this.focusKey);

    const currentComponent = this.focusableComponents[fromParentFocusKey || this.focusKey];

    this.log(
      'smartNavigate', 'currentComponent',
      currentComponent ? currentComponent.focusKey : undefined,
      currentComponent ? currentComponent.node : undefined
    );

    if (currentComponent) {
      const {parentFocusKey, focusKey, layout} = currentComponent;

      const isVerticalDirection = direction === DIRECTION_DOWN || direction === DIRECTION_UP;
      const isIncrementalDirection = direction === DIRECTION_DOWN || direction === DIRECTION_RIGHT;

      const currentCutoffCoordinate = SpatialNavigation.getCutoffCoordinate(
        isVerticalDirection,
        isIncrementalDirection,
        false,
        layout
      );

      /**
       * Get only the siblings with the coords on the way of our moving direction
       */
      const siblings = filter(this.focusableComponents, (component) => {
        if (component.parentFocusKey === parentFocusKey) {
          const siblingCutoffCoordinate = SpatialNavigation.getCutoffCoordinate(
            isVerticalDirection,
            isIncrementalDirection,
            true,
            component.layout
          );

          return isIncrementalDirection ?
            siblingCutoffCoordinate >= currentCutoffCoordinate :
            siblingCutoffCoordinate <= currentCutoffCoordinate;
        }

        return false;
      });

      if (this.debug) {
        this.log('smartNavigate', 'currentCutoffCoordinate', currentCutoffCoordinate);
        this.log(
          'smartNavigate', 'siblings', `${siblings.length} elements:`,
          siblings.map((s) => s.focusKey).join(', '),
          siblings.map((s) => s.node)
        );
      }

      if (this.visualDebugger) {
        const refCorners = SpatialNavigation.getRefCorners(direction, false, layout);

        this.visualDebugger.drawPoint(refCorners.a.x, refCorners.a.y);
        this.visualDebugger.drawPoint(refCorners.b.x, refCorners.b.y);
      }

      const sortedSiblings = this.sortSiblingsByPriority(
        siblings,
        layout,
        direction,
        focusKey
      );

      const nextComponent = first(sortedSiblings);

      this.log(
        'smartNavigate', 'nextComponent',
        nextComponent ? nextComponent.focusKey : undefined,
        nextComponent ? nextComponent.node : undefined
      );

      if (nextComponent) {
        this.setFocus(nextComponent.focusKey);
      } else {
        const parentComponent = this.focusableComponents[parentFocusKey];

        this.saveLastFocusedChildKey(parentComponent, focusKey);

        this.smartNavigate(direction, parentFocusKey);
      }
    }
  }

  saveLastFocusedChildKey(component, focusKey) {
    if (component) {
      this.log('saveLastFocusedChildKey', `${component.focusKey} lastFocusedChildKey set`, focusKey);
      component.lastFocusedChildKey = focusKey;
    }
  }

  log(functionName, debugString, ...rest) {
    if (this.debug) {
      console.log(
        `%c${functionName}%c${debugString}`,
        `background: ${DEBUG_FN_COLORS[this.logIndex % DEBUG_FN_COLORS.length]}; color: black; padding: 1px 5px;`,
        'background: #333; color: #BADA55; padding: 1px 5px;',
        ...rest
      );
    }
  }

  /**
   * This function tries to determine the next component to Focus
   * It's either the target node OR the one down by the Tree if node has children components
   * Based on "targetFocusKey" that means the "intended component to focus"
   */
  getNextFocusKey(targetFocusKey) {
    const targetComponent = this.focusableComponents[targetFocusKey];

    /**
     * Security check, if component doesn't exist, stay on the same focusKey
     */
    if (!targetComponent) {
      return targetFocusKey;
    }

    const children = filter(this.focusableComponents, (component) => component.parentFocusKey === targetFocusKey);

    if (children.length > 0) {
      this.onIntermediateNodeBecameFocused(targetFocusKey);

      const {lastFocusedChildKey, preferredChildFocusKey} = targetComponent;

      this.log('getNextFocusKey', 'lastFocusedChildKey is', lastFocusedChildKey);
      this.log('getNextFocusKey', 'preferredChildFocusKey is', preferredChildFocusKey);

      /**
       * First of all trying to focus last focused child
       */
      if (lastFocusedChildKey &&
        !targetComponent.forgetLastFocusedChild &&
        this.isFocusableComponent(lastFocusedChildKey)
      ) {
        this.log('getNextFocusKey', 'lastFocusedChildKey will be focused', lastFocusedChildKey);

        return this.getNextFocusKey(lastFocusedChildKey);
      }

      /**
       * If there is no lastFocusedChild, trying to focus the preferred focused key
       */
      if (preferredChildFocusKey && this.isFocusableComponent(preferredChildFocusKey)) {
        this.log('getNextFocusKey', 'preferredChildFocusKey will be focused', preferredChildFocusKey);

        return this.getNextFocusKey(preferredChildFocusKey);
      }

      /**
       * Otherwise, trying to focus something by coordinates
       */
      const sortedXChildren = sortBy(children, (child) => child.layout.left);
      const sortedYChildren = sortBy(sortedXChildren, (child) => child.layout.top);
      const {focusKey: childKey} = first(sortedYChildren);

      this.log('getNextFocusKey', 'childKey will be focused', childKey);

      return this.getNextFocusKey(childKey);
    }

    /**
     * If no children, just return targetFocusKey back
     */
    this.log('getNextFocusKey', 'targetFocusKey', targetFocusKey);

    return targetFocusKey;
  }

  addFocusable({
    focusKey,
    node,
    parentFocusKey,
    onEnterPressHandler,
    onBecameFocusedHandler,
    forgetLastFocusedChild,
    trackChildren,
    onUpdateFocus,
    onUpdateHasFocusedChild,
    preferredChildFocusKey
  }) {
    this.focusableComponents[focusKey] = {
      focusKey,
      node,
      parentFocusKey,
      onEnterPressHandler,
      onBecameFocusedHandler,
      onUpdateFocus,
      onUpdateHasFocusedChild,
      forgetLastFocusedChild,
      trackChildren,
      lastFocusedChildKey: null,
      preferredChildFocusKey,
      layout: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        left: 0,
        top: 0
      }
    };

    this.updateLayout(focusKey);

    /**
     * If for some reason this component was already focused before it was added, call the update
     */
    if (focusKey === this.focusKey) {
      this.setFocus(focusKey);
    }
  }

  removeFocusable({focusKey}) {
    const componentToRemove = this.focusableComponents[focusKey];

    if (componentToRemove) {
      const {parentFocusKey} = componentToRemove;

      Reflect.deleteProperty(this.focusableComponents, focusKey);

      const parentComponent = this.focusableComponents[parentFocusKey];
      const isFocused = focusKey === this.focusKey;

      /**
       * If the component was stored as lastFocusedChild, clear lastFocusedChildKey from parent
       */
      parentComponent && parentComponent.lastFocusedChildKey === focusKey &&
        (parentComponent.lastFocusedChildKey = null);

      /**
       * If the component was also focused at this time, focus another one
       */
      if (isFocused) {
        this.setFocus(parentFocusKey);
      }
    }
  }

  getNodeLayoutByFocusKey(focusKey) {
    const component = this.focusableComponents[focusKey];

    if (component) {
      return component.layout;
    }

    return null;
  }

  setCurrentFocusedKey(focusKey) {
    if (this.isFocusableComponent(this.focusKey) && focusKey !== this.focusKey) {
      const oldComponent = this.focusableComponents[this.focusKey];
      const parentComponent = this.focusableComponents[oldComponent.parentFocusKey];

      this.saveLastFocusedChildKey(parentComponent, this.focusKey);

      oldComponent.onUpdateFocus(false);
    }

    this.focusKey = focusKey;

    const newComponent = this.focusableComponents[this.focusKey];

    newComponent && newComponent.onUpdateFocus(true);
  }

  updateParentsWithFocusedChild(focusKey) {
    const parents = [];

    let currentComponent = this.focusableComponents[focusKey];

    /**
     * Recursively iterate the tree up and find all the parents' focus keys
     */
    while (currentComponent) {
      const {parentFocusKey} = currentComponent;

      const parentComponent = this.focusableComponents[parentFocusKey];

      if (parentComponent) {
        const {focusKey: currentParentFocusKey} = parentComponent;

        parents.push(currentParentFocusKey);
      }

      currentComponent = parentComponent;
    }

    const parentsToRemoveFlag = difference(this.parentsHavingFocusedChild, parents);
    const parentsToAddFlag = difference(parents, this.parentsHavingFocusedChild);

    forEach(parentsToRemoveFlag, (parentFocusKey) => {
      const parentComponent = this.focusableComponents[parentFocusKey];

      parentComponent && parentComponent.trackChildren && parentComponent.onUpdateHasFocusedChild(false);
    });

    forEach(parentsToAddFlag, (parentFocusKey) => {
      const parentComponent = this.focusableComponents[parentFocusKey];

      parentComponent && parentComponent.trackChildren && parentComponent.onUpdateHasFocusedChild(true);
    });

    this.parentsHavingFocusedChild = parents;
  }

  getKeyMap() {
    return this.keyMap;
  }

  setKeyMap(keyMap) {
    this.keyMap = {
      ...this.getKeyMap(),
      ...keyMap
    };
  }

  isFocusableComponent(focusKey) {
    return !!this.focusableComponents[focusKey];
  }

  onIntermediateNodeBecameFocused(focusKey) {
    this.isFocusableComponent(focusKey) &&
      this.focusableComponents[focusKey].onBecameFocusedHandler(this.getNodeLayoutByFocusKey(focusKey));
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  setFocus(focusKey, overwriteFocusKey) {
    if (!this.enabled) {
      return;
    }

    const targetFocusKey = overwriteFocusKey || focusKey;

    const newFocusKey = this.getNextFocusKey(targetFocusKey);

    this.log('setFocus', 'newFocusKey', newFocusKey);

    this.setCurrentFocusedKey(newFocusKey);
    this.updateParentsWithFocusedChild(newFocusKey);
    this.updateAllLayouts();
  }

  updateAllLayouts() {
    forOwn(this.focusableComponents, (component, focusKey) => {
      this.updateLayout(focusKey);
    });
  }

  updateLayout(focusKey) {
    const component = this.focusableComponents[focusKey];

    if (!component) {
      return;
    }

    const {node} = component;

    measureLayout(node, (x, y, width, height, left, top) => {
      component.layout = {
        x,
        y,
        width,
        height,
        left,
        top
      };
    });
  }

  updateFocusable(focusKey, {node, preferredChildFocusKey}) {
    const component = this.focusableComponents[focusKey];

    if (component) {
      component.preferredChildFocusKey = preferredChildFocusKey;

      if (node) {
        component.node = node;
      }
    }
  }
}

/**
 * Export singleton
 */
export default new SpatialNavigation();
