"use strict";
/**
 * VirtualListView.tsx
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT license.
 *
 * A cross-platform virtualized list view supporting variable-height items and
 * methods to navigate to specific items by index.
 *
 * Misc notes to help understand the flow:
 * 1. There are only a few ways to enter calculation flows:
 *    * _updateStateFromProps: We got new props
 *    * _onLayoutContainer: Our outer container rendered and/or changed size
 *    * _onLayoutItem: An item rendered and/or changed changed size
 *    * _onScroll: The user scrolled the container
 *    Everything else is a helper function for these four entry points.
 * 2. We largely ignore the React lifecycle here. We completely eschew state in favor of forceUpdate when
 *    we know that we need to  call render(). We cheat and use the animation code to move items and make
 *    them opaque/invisible at the right time outside of the render cycle.
 * 3. Items are rendered in containers called "cells". Cells are allocated on demand and given their own keys.
 *    When an item is no longer within the view port (e.g. in response to the the user scrolling), the corresponding
 *    cell is recycled to avoid unmounting and mounting. These recycled cells are rendered in a position that is
 *    not visible to the user. When a new cell is needed, we consult the recycled cell list to find one that matches
 *    the specified "template" of the new item. Callers should set the template field in a way that all similar items
 *     share the same template. This will minimize the amount of work that React needs to be done to reuse the recycled
 *    cell.
 * 3. The intended render flow is as follows:
 *    * Start filling hidden items from top down
 *    * Wait for items to be measured (or if heights are known, then bypass this step)
 *    * Set the translation of all items such that they appear in view at the same time without new items popping
 *      into existence afterward.
 * 4. We address the issue of unexpected item heights tracking _heightAboveRenderAdjustment. When this is
 *    non-zero, it means that our initial guess for one or more items was wrong, so the _containerHeight is
 *    currently incorrect. Correcting this is an expensive and potentially disruptive action because it
 *    involves setting the container height, repositioning all visible cells and setting the scroll
 *    position all in the same frame if possible.
 */
Object.defineProperty(exports, "__esModule", { value: true });
var tslib_1 = require("tslib");
var _ = require("lodash");
var react_1 = require("react");
var RX = require("reactxp");
var assert_1 = require("./assert");
var VirtualListCell_1 = require("./VirtualListCell");
var FocusDirection;
(function (FocusDirection) {
    FocusDirection[FocusDirection["Up"] = -1] = "Up";
    FocusDirection[FocusDirection["Down"] = 1] = "Down";
})(FocusDirection || (FocusDirection = {}));
var _styles = {
    scrollContainer: RX.Styles.createScrollViewStyle({
        flex: 1,
        position: 'relative',
        flexDirection: 'column',
    }),
    staticContainer: RX.Styles.createViewStyle({
        flex: 1,
        flexDirection: 'column',
    }),
};
var _isNativeAndroid = RX.Platform.getType() === 'android';
var _isNativeIOS = RX.Platform.getType() === 'ios';
var _isWeb = RX.Platform.getType() === 'web';
// How many items with unknown heights will we allow? A larger value will fill the view more
// quickly but will result in a bunch of long-running work that can cause frame skips during
// animations.
var _maxSimultaneousMeasures = 16;
// Recycled cells remain mounted to reduce the allocations and deallocations.
// This value controls how many we maintain before culling.
var _maxRecycledCells = 50;
var _maxRecycledCellsForAccessibility = 0;
var _virtualKeyPrefix = 'vc_';
var _accessibilityVirtualKeyPrefix = 'ac_';
// Key codes used on web/RN (keycodes for arrows are different between web and native, unfortunately)
// (a resolution for https://github.com/Microsoft/reactxp/issues/419 will make this look better, hopefuly)
var _keyCodeUpArrow = _isWeb ? 38 : 19;
var _keyCodeDownArrow = _isWeb ? 40 : 20;
var VirtualListView = /** @class */ (function (_super) {
    tslib_1.__extends(VirtualListView, _super);
    function VirtualListView(props) {
        var _this = _super.call(this, props) || this;
        _this._lastScrollTop = 0;
        _this._layoutHeight = 0;
        _this._layoutWidth = 0;
        // Cache the width for rendered items for reuse/optimization
        _this._contentWidth = -1;
        _this._isMounted = false;
        // Controls the full height of the scrolling view, independent of the view port height
        _this._containerHeight = 0;
        _this._containerHeightValue = RX.Animated.createValue(_this._containerHeight);
        _this._containerAnimatedStyle = RX.Styles.createAnimatedViewStyle({
            height: _this._containerHeightValue,
        });
        // A dictionary of items that maps item keys to item indexes.
        _this._itemMap = new Map();
        _this._scrollViewRef = react_1.createRef();
        // When we need to actually re-render, mark this until it's resolved
        _this._isRenderDirty = false;
        // Number of pending item animations. We defer some actions while animations are pending.
        _this._pendingAnimations = new Set();
        // We attempt to guess the size of items before we render them, but if we're wrong, we need to accumulate the guess
        // error so that we can correct it later.
        _this._heightAboveRenderAdjustment = 0;
        // Cache the heights of blocks of the list
        _this._heightAboveRenderBlock = 0;
        _this._heightOfRenderBlock = 0;
        _this._heightBelowRenderBlock = 0;
        // Count the number of items above, in, and below the render block
        _this._itemsAboveRenderBlock = 0;
        _this._itemsInRenderBlock = 0;
        _this._itemsBelowRenderBlock = 0;
        // Items that we're waiting on a measure from
        _this._pendingMeasurements = new Set();
        // We first render items to fill the visible screen, and then render past it in another render pass.
        _this._isInitialFillComplete = false;
        // Save a height cache of things that are no longer being rendered because we may scroll them off screen and still
        // want to know what their height is to calculate the size.
        _this._heightCache = new Map();
        // Cells that contain visible items.
        _this._activeCells = new Map();
        // Cells that were previously allocated but no longer contain items that are visible.
        // They are kept around and reused to avoid exceess allocations.
        _this._recycledCells = [];
        // List of cells that are rendered
        _this._navigatableItemsRendered = [];
        // Recycled cells remain mounted to reduce the allocations and deallocations.
        // This value controls how many we maintain before culling.
        _this._maxRecycledCells = _maxRecycledCells;
        _this._isScreenReaderEnabled = false;
        // Fraction of screen height that we render above and below the visible screen.
        _this._renderOverdrawFactor = 0.5;
        _this._minOverdrawAmount = 512;
        _this._maxOverdrawAmount = 4096;
        // These must be at least as big as the numbers above to avoid feedback loops.
        _this._cullFraction = 1.0;
        _this._minCullAmount = _this._minOverdrawAmount * 2;
        _this._onLayoutContainer = function (e) {
            if (!_this._isMounted) {
                return;
            }
            var layoutWidth = e.width;
            if (_this.props.padding) {
                layoutWidth -= _this.props.padding;
            }
            var layoutHeight = e.height;
            if (layoutWidth !== _this._layoutWidth) {
                if (_this.props.logInfo) {
                    _this.props.logInfo('New layout width: ' + layoutWidth);
                }
                _this._layoutWidth = layoutWidth;
                _this._resizeAllItems(_this.props);
            }
            if (layoutHeight !== _this._layoutHeight) {
                if (_this.props.logInfo) {
                    _this.props.logInfo('New layout height: ' + layoutHeight);
                }
                _this._layoutHeight = layoutHeight;
                _this._calcNewRenderedItemState(_this.props);
                _this._renderIfDirty(_this.props);
                // See if we have accumulated enough error to require an adjustment.
                _this._reconcileCorrections(_this.props);
            }
            if (_this.props.onLayout) {
                _this.props.onLayout(e);
            }
        };
        _this._onLayoutItem = function (itemKey, newHeight) {
            if (!_this._isMounted) {
                return;
            }
            var itemIndex = _this._itemMap.get(itemKey);
            // Because this event is async on some platforms, the index may have changed or
            // the item could have been removed by the time the event arrives.
            if (itemIndex === undefined) {
                return;
            }
            var item = _this.props.itemList[itemIndex];
            var oldHeight = _this._getHeightOfItem(item);
            if (!item.measureHeight) {
                // Trust constant-height items, even if the layout tells us otherwise.
                // We shouldn't even get this callback, since we don't specify an onLayout in this case.
                if (_this.props.logInfo) {
                    _this.props.logInfo('Item ' + itemKey + ' listed as known height (' + oldHeight +
                        '), but got an itemOnLayout anyway? (Reported Height: ' + newHeight + ')');
                }
                return;
            }
            _this._heightCache.set(itemKey, newHeight);
            if (itemIndex < _this._itemsAboveRenderBlock || itemIndex >= _this._itemsAboveRenderBlock + _this._itemsInRenderBlock) {
                // Getting a response for a culled item (no longer in tracked render block), so track the height but don't update anything.
                return;
            }
            var needsRecalc = false;
            if (oldHeight !== newHeight) {
                if (_this.props.logInfo) {
                    _this.props.logInfo('onLayout: Item Height Changed: ' + itemKey + ' - Old: ' + oldHeight + ', New: ' + newHeight);
                }
                _this._heightOfRenderBlock += (newHeight - oldHeight);
                if (_this._isInitialFillComplete) {
                    // See if there are any visible items before this one.
                    var foundVisibleItemBefore = false;
                    for (var i = _this._itemsAboveRenderBlock; i < _this._itemsAboveRenderBlock + _this._itemsInRenderBlock; i++) {
                        if (_this._isCellVisible(_this.props.itemList[i].key)) {
                            foundVisibleItemBefore = true;
                            break;
                        }
                        if (i === itemIndex) {
                            break;
                        }
                    }
                    if (!foundVisibleItemBefore) {
                        // It's in a safe block above the known-height render area.
                        if (_this.props.logInfo) {
                            _this.props.logInfo('Added delta to fake space offset: ' + (oldHeight - newHeight) + ' -> ' +
                                (_this._heightAboveRenderAdjustment + (oldHeight - newHeight)));
                        }
                        _this._heightAboveRenderAdjustment += (oldHeight - newHeight);
                    }
                }
                needsRecalc = true;
            }
            _this._pendingMeasurements.delete(itemKey);
            needsRecalc = needsRecalc || _this._pendingMeasurements.size === 0;
            if (needsRecalc) {
                _this._calcNewRenderedItemState(_this.props);
                _this._renderIfDirty(_this.props);
            }
            // See if we have accumulated enough error to require an adjustment.
            _this._reconcileCorrections(_this.props);
        };
        _this._onAnimateStartStopItem = function (itemKey, animateStart) {
            if (_this._isMounted) {
                var hasAnimation = _this._pendingAnimations.has(itemKey);
                if (animateStart) {
                    assert_1.default(!hasAnimation, 'unexpected animation start');
                    _this._pendingAnimations.add(itemKey);
                }
                else {
                    assert_1.default(hasAnimation, 'unexpected animation complete');
                    _this._pendingAnimations.delete(itemKey);
                    // We defer this because there are cases where we can cancel animations
                    // because we've received new props. We don't want to re-enter the
                    // routines with the old props, so we'll defer and wait for this.props
                    // to be updated.
                    _.defer(function () {
                        if (_this._isMounted) {
                            if (_this._pendingAnimations.size === 0 && _this._isMounted) {
                                // Perform deferred actions now that all animations are complete.
                                _this._reconcileCorrections(_this.props);
                            }
                        }
                    });
                }
            }
        };
        _this._onScroll = function (scrollTop, scrollLeft) {
            if (_this._lastScrollTop === scrollTop) {
                // Already know about it!
                if (_this.props.logInfo) {
                    _this.props.logInfo('Got Known Scroll: ' + scrollTop);
                }
                return;
            }
            _this._lastScrollTop = scrollTop;
            // We scrolled, so update item state.
            _this._calcNewRenderedItemState(_this.props);
            _this._renderIfDirty(_this.props);
            // See if we have accumulated enough error to require an adjustment.
            _this._reconcileCorrections(_this.props);
            if (_this.props.onScroll) {
                _this.props.onScroll(scrollTop, scrollLeft);
            }
        };
        _this.scrollToTop = function (animated, top) {
            if (animated === void 0) { animated = true; }
            if (top === void 0) { top = 0; }
            var scrollView = _this._scrollViewRef.current;
            if (scrollView) {
                scrollView.setScrollTop(top, animated);
            }
        };
        _this._onItemFocused = function (itemInfo) {
            if (itemInfo) {
                _this.setState({
                    lastFocusedItemKey: itemInfo.key,
                    isFocused: true,
                });
            }
            else {
                _this.setState({ isFocused: false });
            }
            if (_this.props.onItemFocused) {
                _this.props.onItemFocused(itemInfo);
            }
        };
        _this._onItemSelected = function (itemInfo) {
            if (itemInfo) {
                _this.selectItemKey(itemInfo.key, false);
                if (_this.props.onItemSelected) {
                    _this.props.onItemSelected(itemInfo);
                }
            }
        };
        _this._onKeyDown = function (e) {
            if (!_this._scrollViewRef.current ||
                (e.keyCode !== _keyCodeUpArrow && e.keyCode !== _keyCodeDownArrow)) {
                return;
            }
            // Is it an "up arrow" key?
            if (e.keyCode === _keyCodeUpArrow) {
                _this._focusSubsequentItem(FocusDirection.Up, true);
                e.preventDefault();
                // Is it a "down arrow" key?
            }
            else if (e.keyCode === _keyCodeDownArrow) {
                _this._focusSubsequentItem(FocusDirection.Down, true);
                e.preventDefault();
            }
        };
        _this._screenReaderStateChanged = function (isEnabled) {
            if (isEnabled) {
                _this._setupForAccessibility();
                if (_isNativeAndroid) {
                    // We need to re-render virtual cells.
                    _this._isRenderDirty = true;
                }
                _this._renderIfDirty(_this.props);
            }
            else {
                _this._tearDownForAccessibility();
            }
        };
        _this._updateStateFromProps(props, true);
        _this.state = {
            lastFocusedItemKey: _.some(props.itemList, function (item) { return item.key === props.initialSelectedKey; }) ?
                props.initialSelectedKey :
                undefined,
            selectedItemKey: _.some(props.itemList, function (item) { return item.key === props.initialSelectedKey; }) ?
                props.initialSelectedKey :
                undefined,
        };
        return _this;
    }
    VirtualListView.prototype.UNSAFE_componentWillReceiveProps = function (nextProps) {
        if (!_.isEqual(this.props, nextProps)) {
            this._updateStateFromProps(nextProps, false);
        }
    };
    VirtualListView.prototype.UNSAFE_componentWillUpdate = function (nextProps, nextState) {
        var updatedState = {};
        var updateState = false;
        if (nextState.lastFocusedItemKey && !_.some(nextProps.itemList, function (item) { return item.key === nextState.lastFocusedItemKey; })) {
            updateState = true;
            updatedState.lastFocusedItemKey = undefined;
        }
        if (nextState.selectedItemKey && !_.some(nextProps.itemList, function (item) { return item.key === nextState.selectedItemKey; })) {
            updateState = true;
            updatedState.selectedItemKey = undefined;
        }
        if (updateState) {
            this.setState(updatedState);
        }
    };
    VirtualListView.prototype._setupForAccessibility = function () {
        if (this.props.logInfo) {
            this.props.logInfo('Screen reader enabled.');
        }
        this._isScreenReaderEnabled = true;
        if (_isNativeIOS || _isNativeAndroid) {
            // Clear recycled cells and turn off recycling.
            if (this._recycledCells.length > 0) {
                this._recycledCells = [];
                this._isRenderDirty = true;
            }
            this._maxRecycledCells = _maxRecycledCellsForAccessibility;
        }
    };
    VirtualListView.prototype._tearDownForAccessibility = function () {
        if (this.props.logInfo) {
            this.props.logInfo('Screen reader disabled.');
        }
        this._isScreenReaderEnabled = false;
        if (_isNativeIOS || _isNativeAndroid) {
            // Enable recycling.
            this._maxRecycledCells = _maxRecycledCells;
        }
    };
    VirtualListView.prototype._isAndroidScreenReaderEnabled = function () {
        return this._isScreenReaderEnabled && _isNativeAndroid;
    };
    VirtualListView.prototype._updateStateFromProps = function (props, initialBuild) {
        if (props.logInfo) {
            props.logInfo('Rebuilding VirtualListView State - initial: ' + initialBuild +
                ', items: ' + props.itemList.length);
        }
        if (initialBuild && props.skipRenderIfItemUnchanged) {
            // When we are using smart rerender we can make overdraw much larger
            this._renderOverdrawFactor = 5;
            this._minOverdrawAmount = 2048;
            this._maxOverdrawAmount = 4096;
            this._cullFraction = 6;
            this._minCullAmount = 3072;
        }
        if (initialBuild || !_.isEqual(this.props.itemList, props.itemList)) {
            this._handleItemListChange(props);
            this._calcNewRenderedItemState(props);
        }
        this._renderIfDirty(props);
    };
    VirtualListView.prototype._handleItemListChange = function (props) {
        // Build a new item map.
        var newItemMap = new Map();
        var itemIndex = -1;
        for (var _i = 0, _a = props.itemList; _i < _a.length; _i++) {
            var item = _a[_i];
            itemIndex++;
            // Make sure there are no duplicate keys.
            if (newItemMap.has(item.key)) {
                assert_1.default(false, 'Found a duplicate key: ' + item.key);
                if (props.logInfo) {
                    props.logInfo('Item with key ' + item.key + ' is duplicated at positions ' + itemIndex +
                        ' and ' + newItemMap.get(item.key));
                }
            }
            newItemMap.set(item.key, itemIndex);
            if (this.props && this.props.itemList) {
                var cell = this._activeCells.get(item.key);
                if (cell) {
                    var oldItemIndex = this._itemMap.get(item.key);
                    if (oldItemIndex === undefined) {
                        cell.shouldUpdate = true;
                    }
                    else {
                        var oldItem = this.props.itemList[oldItemIndex];
                        if (this.props.skipRenderIfItemUnchanged || !_.isEqual(oldItem, item)) {
                            cell.shouldUpdate = true;
                        }
                    }
                }
            }
        }
        // Stop tracking the heights of deleted items.
        var oldItems = (this.props && this.props.itemList) ? this.props.itemList : [];
        itemIndex = -1;
        for (var _b = 0, oldItems_1 = oldItems; _b < oldItems_1.length; _b++) {
            var item = oldItems_1[_b];
            itemIndex++;
            if (!newItemMap.has(item.key)) {
                // If we're deleting an item that's above the current render block,
                // update the adjustment so we avoid an unnecessary scroll.
                // Update focused item if it's the one removed, if we're unable to, reset focus
                if (item.key === this.state.lastFocusedItemKey) {
                    if (!this._focusSubsequentItem(FocusDirection.Down, false, false) &&
                        !this._focusSubsequentItem(FocusDirection.Up, false, false)) {
                        this.setState({ lastFocusedItemKey: undefined });
                    }
                }
                if (itemIndex < this._itemsAboveRenderBlock) {
                    this._heightAboveRenderAdjustment += this._getHeightOfItem(oldItems[itemIndex]);
                }
                this._heightCache.delete(item.key);
                this._pendingMeasurements.delete(item.key);
                // Recycle any deleted active cells up front so they can be recycled below.
                if (this._activeCells.has(item.key)) {
                    this._recycleCell(item.key);
                }
            }
        }
        var overdrawAmount = this._calcOverdrawAmount();
        var renderBlockTopLimit = this._lastScrollTop - overdrawAmount;
        var renderBlockBottomLimit = this._lastScrollTop + this._layoutHeight + overdrawAmount;
        var yPosition = this._heightAboveRenderAdjustment;
        var lookingForStartOfRenderBlock = true;
        this._itemsAboveRenderBlock = 0;
        this._itemsInRenderBlock = 0;
        // Determine the new bounds of the render block.
        itemIndex = -1;
        for (var _c = 0, _d = props.itemList; _c < _d.length; _c++) {
            var item = _d[_c];
            itemIndex++;
            var itemHeight = this._getHeightOfItem(item);
            yPosition += itemHeight;
            if (yPosition <= renderBlockTopLimit) {
                if (this._activeCells.has(item.key)) {
                    this._recycleCell(item.key);
                }
            }
            else {
                if (lookingForStartOfRenderBlock) {
                    this._itemsAboveRenderBlock = itemIndex;
                    lookingForStartOfRenderBlock = false;
                }
                if (yPosition - itemHeight < renderBlockBottomLimit) {
                    // We're within the render block.
                    this._itemsInRenderBlock++;
                    if (this._activeCells.has(item.key)) {
                        this._setCellTopAndVisibility(item.key, this._shouldShowItem(item, props), yPosition - itemHeight, !!props.animateChanges);
                    }
                    else {
                        this._allocateCell(item.key, item.template, itemIndex, !item.measureHeight, item.height, yPosition - itemHeight, this._shouldShowItem(item, props));
                        if (!this._isItemHeightKnown(item)) {
                            this._pendingMeasurements.add(item.key);
                        }
                    }
                }
                else {
                    // We're past the render block.
                    if (this._activeCells.has(item.key)) {
                        this._recycleCell(item.key);
                    }
                }
            }
        }
        // Replace the item map with the updated version.
        this._itemMap = newItemMap;
        this._itemsBelowRenderBlock = props.itemList.length - this._itemsAboveRenderBlock -
            this._itemsInRenderBlock;
        this._heightAboveRenderBlock = this._calcHeightOfItems(props, 0, this._itemsAboveRenderBlock - 1);
        this._heightOfRenderBlock = this._calcHeightOfItems(props, this._itemsAboveRenderBlock, this._itemsAboveRenderBlock + this._itemsInRenderBlock - 1);
        this._heightBelowRenderBlock = this._calcHeightOfItems(props, this._itemsAboveRenderBlock + this._itemsInRenderBlock, props.itemList.length - 1);
        // Pre-populate the container height with known values early - if there are dynamically sized items in the list, this will be
        // corrected during the onLayout phase
        if (this._containerHeight === 0) {
            this._containerHeight = this._heightAboveRenderBlock + this._heightOfRenderBlock + this._heightBelowRenderBlock;
            this._containerHeightValue.setValue(this._containerHeight);
        }
    };
    VirtualListView.prototype._calcOverdrawAmount = function () {
        return this._isInitialFillComplete ?
            Math.min(Math.max(this._layoutHeight * this._renderOverdrawFactor, this._minOverdrawAmount), this._maxOverdrawAmount) :
            0;
    };
    // Some things to keep in mind during this function:
    // * Item heights are all in a fixed state from the beginning to the end of the function. The total
    //   container height will never change through the course of the function. We're only deciding what
    //   to bother rendering/culling and where to place items within the container.
    // * We're going to, in order: cull unnecessary items, add new items, and position them within the container.
    VirtualListView.prototype._calcNewRenderedItemState = function (props) {
        var _this = this;
        if (this._layoutHeight === 0) {
            // Wait until we get a height before bothering.
            return;
        }
        if (props.itemList.length === 0) {
            // Can't possibly be rendering anything.
            return;
        }
        if (this._pendingMeasurements.size > 0) {
            // Don't bother if we're still measuring things. Wait for the last batch to end.
            return;
        }
        // What's the top/bottom line that we'll cull items that are wholly outside of?
        var cullMargin = Math.max(this._layoutHeight * this._cullFraction, this._minCullAmount);
        var topCullLine = this._lastScrollTop - cullMargin;
        var bottomCullLine = this._lastScrollTop + this._layoutHeight + cullMargin;
        // Do we need to cut anything out of the top because we've scrolled away from it?
        while (this._itemsInRenderBlock > 0) {
            var itemIndex = this._itemsAboveRenderBlock;
            var item = props.itemList[itemIndex];
            if (!this._isItemHeightKnown(item)) {
                break;
            }
            var itemHeight = this._getHeightOfItem(item);
            if (this._heightAboveRenderAdjustment + this._heightAboveRenderBlock + itemHeight >= topCullLine) {
                // We're rendering up to the top render line, so don't need to nuke any more.
                break;
            }
            this._itemsInRenderBlock--;
            this._heightOfRenderBlock -= itemHeight;
            this._itemsAboveRenderBlock++;
            this._heightAboveRenderBlock += itemHeight;
            this._recycleCell(item.key);
            if (props.logInfo) {
                props.logInfo('Culled Item From Top: ' + item.key);
            }
        }
        // Do we need to cut anything out of the bottom because we've scrolled away from it?
        while (this._itemsInRenderBlock > 0) {
            var itemIndex = this._itemsAboveRenderBlock + this._itemsInRenderBlock - 1;
            var item = props.itemList[itemIndex];
            if (!this._isItemHeightKnown(item)) {
                break;
            }
            var itemHeight = this._getHeightOfItem(item);
            if (this._heightAboveRenderAdjustment + this._heightAboveRenderBlock + this._heightOfRenderBlock
                - itemHeight <= bottomCullLine) {
                break;
            }
            this._itemsInRenderBlock--;
            this._heightOfRenderBlock -= itemHeight;
            this._itemsBelowRenderBlock++;
            this._heightBelowRenderBlock += itemHeight;
            this._recycleCell(item.key);
            if (props.logInfo) {
                props.logInfo('Culled Item From Bottom: ' + item.key);
            }
        }
        // Determine what the line is that we're rendering up to. If we haven't yet filled a screen,
        // first get the screen full before over-rendering.
        var overdrawAmount = this._calcOverdrawAmount();
        var renderMargin = this._isInitialFillComplete ? overdrawAmount : 0;
        var renderBlockTopLimit = this._lastScrollTop - renderMargin;
        var renderBlockBottomLimit = this._lastScrollTop + this._layoutHeight + renderMargin;
        if (this._itemsInRenderBlock === 0) {
            var yPosition_1 = this._heightAboveRenderAdjustment;
            this._itemsAboveRenderBlock = 0;
            // Find the first item that's in the render block and add it.
            for (var i = 0; i < props.itemList.length; i++) {
                var item = props.itemList[i];
                var itemHeight = this._getHeightOfItem(item);
                yPosition_1 += itemHeight;
                if (yPosition_1 > renderBlockTopLimit) {
                    this._itemsAboveRenderBlock = i;
                    this._itemsInRenderBlock = 1;
                    this._allocateCell(item.key, item.template, i, !item.measureHeight, item.height, yPosition_1 - itemHeight, this._shouldShowItem(item, props));
                    if (!this._isItemHeightKnown(item)) {
                        this._pendingMeasurements.add(item.key);
                    }
                    break;
                }
            }
            this._itemsBelowRenderBlock = props.itemList.length - this._itemsAboveRenderBlock - this._itemsInRenderBlock;
            this._heightAboveRenderBlock = this._calcHeightOfItems(props, 0, this._itemsAboveRenderBlock - 1);
            this._heightOfRenderBlock = this._calcHeightOfItems(props, this._itemsAboveRenderBlock, this._itemsAboveRenderBlock + this._itemsInRenderBlock - 1);
            this._heightBelowRenderBlock = this._calcHeightOfItems(props, this._itemsAboveRenderBlock + this._itemsInRenderBlock, props.itemList.length - 1);
        }
        // What is the whole height of the scroll region? We need this both for calculating bottom
        // offsets as well as for making the view render to the proper height since we're using
        // position: absolute for all placements.
        var itemBlockHeight = this._heightAboveRenderAdjustment + this._heightAboveRenderBlock +
            this._heightOfRenderBlock + this._heightBelowRenderBlock;
        var containerHeight = Math.max(itemBlockHeight, this._layoutHeight);
        // Render the actual items now!
        var yPosition = this._heightAboveRenderBlock + this._heightAboveRenderAdjustment;
        var topOfRenderBlockY = yPosition;
        // Start by checking heights/visibility of everything in the render block before we add to it.
        for (var i = 0; i < this._itemsInRenderBlock; i++) {
            var itemIndex = this._itemsAboveRenderBlock + i;
            var item = props.itemList[itemIndex];
            this._setCellTopAndVisibility(item.key, this._shouldShowItem(item, props), yPosition, !!this.props.animateChanges);
            var height = this._getHeightOfItem(item);
            yPosition += height;
        }
        var bottomOfRenderBlockY = yPosition;
        // See if the container height needs adjusting.
        if (containerHeight !== this._containerHeight) {
            if (props.logInfo) {
                props.logInfo('Container Height Change: ' + this._containerHeight + ' to ' + containerHeight);
            }
            this._containerHeight = containerHeight;
            this._containerHeightValue.setValue(containerHeight);
        }
        // Reuse an item-builder.
        var buildItem = function (itemIndex, above) {
            var item = props.itemList[itemIndex];
            var isHeightKnown = _this._isItemHeightKnown(item);
            var itemHeight = _this._getHeightOfItem(item);
            assert_1.default(itemHeight > 0, 'list items should always have non-zero height');
            _this._itemsInRenderBlock++;
            _this._heightOfRenderBlock += itemHeight;
            var yPlacement;
            if (above) {
                _this._itemsAboveRenderBlock--;
                _this._heightAboveRenderBlock -= itemHeight;
                topOfRenderBlockY -= itemHeight;
                yPlacement = topOfRenderBlockY;
            }
            else {
                _this._itemsBelowRenderBlock--;
                _this._heightBelowRenderBlock -= itemHeight;
                yPlacement = bottomOfRenderBlockY;
                bottomOfRenderBlockY += itemHeight;
            }
            if (!isHeightKnown) {
                _this._pendingMeasurements.add(item.key);
            }
            _this._allocateCell(item.key, item.template, itemIndex, !item.measureHeight, item.height, yPlacement, _this._shouldShowItem(item, props));
            if (props.logInfo) {
                props.logInfo('New Item On ' + (above ? 'Top' : 'Bottom') + ': ' + item.key);
            }
        };
        // Try to add items to the bottom of the current render block.
        while (this._pendingMeasurements.size < _maxSimultaneousMeasures) {
            // Stop if we go beyond the bottom render limit.
            if (this._itemsBelowRenderBlock <= 0 ||
                this._heightAboveRenderAdjustment + this._heightAboveRenderBlock +
                    this._heightOfRenderBlock >= renderBlockBottomLimit) {
                break;
            }
            buildItem(this._itemsAboveRenderBlock + this._itemsInRenderBlock, false);
        }
        // Try to add an item to the top of the current render block.
        while (this._pendingMeasurements.size < _maxSimultaneousMeasures) {
            if (this._itemsAboveRenderBlock <= 0 ||
                this._heightAboveRenderAdjustment + this._heightAboveRenderBlock <= renderBlockTopLimit) {
                break;
            }
            buildItem(this._itemsAboveRenderBlock - 1, true);
        }
        // See if we've filled the screen and rendered it, and we're not waiting on any measurements.
        if (!this._isInitialFillComplete && !this._isRenderDirty && this._pendingMeasurements.size === 0) {
            // Time for overrender. Recalc render lines.
            renderMargin = overdrawAmount;
            renderBlockTopLimit = this._lastScrollTop - renderMargin;
            renderBlockBottomLimit = this._lastScrollTop + this._layoutHeight + renderMargin;
            this._popInvisibleIntoView(props);
            // Render pass again!
            this._componentDidRender();
        }
        if (props.logInfo) {
            props.logInfo('CalcNewRenderedItemState: O:' + this._heightAboveRenderAdjustment +
                ' + A:' + this._heightAboveRenderBlock + ' + R:' + this._heightOfRenderBlock + ' + B:' +
                this._heightBelowRenderBlock + ' = ' + itemBlockHeight + ', FilledViewable: ' + this._isInitialFillComplete);
        }
    };
    VirtualListView.prototype._reconcileCorrections = function (props) {
        // If there are pending animations, don't adjust because it will disrupt
        // the animations. When all animations are complete, we will get called back.
        if (this._pendingAnimations.size > 0) {
            return;
        }
        // Calculate the max amount of error we want to accumulate before we adjust
        // the content height size. We don't want to do this too often because it's
        // expensive, but we also don't want to let the error get too great because
        // the scroll bar thumb will not accurately reflect the scroll position.
        var maxFakeSpaceOffset = 0; // Math.max(this._layoutHeight / 2, 256);
        // If the user has scrolled all the way to the boundary of the rendered area,
        // we can't afford any error.
        if (this._lastScrollTop === 0 || this._lastScrollTop < this._heightAboveRenderAdjustment) {
            maxFakeSpaceOffset = 0;
        }
        // Did the error amount exceed our limit?
        if (Math.abs(this._heightAboveRenderAdjustment) > maxFakeSpaceOffset) {
            if (props.logInfo) {
                props.logInfo('Removing _heightAboveRenderAdjustment');
            }
            // We need to adjust the content height, the positions of the rendered items
            // and the scroll position as atomically as possible.
            var newContainerHeight = this._containerHeight - this._heightAboveRenderAdjustment;
            if (props.logInfo) {
                props.logInfo('Container Height Change: ' + this._containerHeight + ' to ' + newContainerHeight);
            }
            this._containerHeight = newContainerHeight;
            this._containerHeightValue.setValue(newContainerHeight);
            for (var i = this._itemsAboveRenderBlock; i < this._itemsAboveRenderBlock + this._itemsInRenderBlock; i++) {
                var item = props.itemList[i];
                var cell = this._activeCells.get(item.key);
                this._setCellTopAndVisibility(item.key, cell.isVisible, cell.top - this._heightAboveRenderAdjustment, false);
            }
            // Clear the adjustment.
            this._heightAboveRenderAdjustment = 0;
        }
    };
    VirtualListView.prototype._popInvisibleIntoView = function (props) {
        if (props.logInfo) {
            props.logInfo('Popping invisible items into view');
        }
        this._isInitialFillComplete = true;
        // Update styles now to snap everything into view.
        for (var i = 0; i < this._itemsInRenderBlock; i++) {
            var itemIndex = this._itemsAboveRenderBlock + i;
            var item = props.itemList[itemIndex];
            var cellInfo = this._activeCells.get(item.key);
            this._setCellTopAndVisibility(item.key, this._shouldShowItem(item, props), cellInfo.top, false);
        }
    };
    VirtualListView.prototype._resizeAllItems = function (props) {
        if (this._layoutWidth > 0 && this._layoutWidth !== this._contentWidth) {
            this._contentWidth = this._layoutWidth;
            this.forceUpdate();
        }
    };
    VirtualListView.prototype._renderIfDirty = function (props) {
        if (this._isRenderDirty) {
            if (this._isMounted) {
                this.forceUpdate();
            }
        }
    };
    // Cell Management Methods
    VirtualListView.prototype._allocateCell = function (itemKey, itemTemplate, itemIndex, isHeightConstant, height, top, isVisible) {
        var newCell = this._activeCells.get(itemKey);
        if (!newCell) {
            // If there's a specified template, see if we can find an existing
            // recycled cell that we can reuse with the same template.
            if (itemTemplate && isHeightConstant) {
                // See if we can find an exact match both in terms of template and previous key.
                // This has the greatest chance of rendering the same as previously.
                var bestOptionIndex = _.findIndex(this._recycledCells, function (cell) { return cell.itemTemplate === itemTemplate &&
                    cell.cachedItemKey === itemKey && cell.height === height; });
                // We couldn't find an exact match. Try to find one with the same template.
                if (bestOptionIndex < 0) {
                    bestOptionIndex = _.findIndex(this._recycledCells, function (cell) { return cell.itemTemplate === itemTemplate; });
                }
                if (bestOptionIndex >= 0) {
                    newCell = this._recycledCells[bestOptionIndex];
                    this._recycledCells.splice(bestOptionIndex, 1);
                }
            }
        }
        if (newCell) {
            // We found an existing cell. Repurpose it.
            newCell.isVisible = isVisible;
            newCell.top = top;
            newCell.shouldUpdate = true;
            assert_1.default(newCell.isHeightConstant === isHeightConstant, 'isHeightConstant assumed to not change');
            assert_1.default(newCell.itemTemplate === itemTemplate, 'itemTemplate assumed to not change');
            var mountedCell = newCell.cellRef.current;
            if (mountedCell) {
                mountedCell.setVisibility(isVisible);
                mountedCell.setTop(top);
                mountedCell.setItemKey(itemKey);
            }
        }
        else {
            // We didn't find a recycled cell that we could use. Allocate a new one.
            newCell = {
                cellRef: react_1.createRef(),
                virtualKey: _virtualKeyPrefix + VirtualListView._nextCellKey,
                itemTemplate: itemTemplate,
                isHeightConstant: isHeightConstant,
                height: height,
                cachedItemKey: itemKey,
                top: top,
                isVisible: isVisible,
                shouldUpdate: true,
            };
            VirtualListView._nextCellKey += 1;
        }
        this._isRenderDirty = true;
        this._activeCells.set(itemKey, newCell);
        return newCell;
    };
    VirtualListView.prototype._recycleCell = function (itemKey) {
        var virtualCellInfo = this._activeCells.get(itemKey);
        if (virtualCellInfo) {
            if (this._maxRecycledCells > 0) {
                this._setCellTopAndVisibility(itemKey, false, virtualCellInfo.top, false);
                // Is there a "template" hint associated with this cell? If so,
                // we may be able to reuse it later.
                if (virtualCellInfo.itemTemplate && virtualCellInfo.isHeightConstant) {
                    this._recycledCells.push(virtualCellInfo);
                    if (this._recycledCells.length > this._maxRecycledCells) {
                        // Delete the oldest recycled cell.
                        this._recycledCells.splice(0, 1);
                        this._isRenderDirty = true;
                    }
                }
                else {
                    // Re-render to force the cell to be unmounted.
                    this._isRenderDirty = true;
                }
            }
            this._activeCells.delete(itemKey);
        }
    };
    VirtualListView.prototype._setCellTopAndVisibility = function (itemKey, isVisibile, top, animateIfPreviouslyVisible) {
        var cellInfo = this._activeCells.get(itemKey);
        if (!cellInfo) {
            assert_1.default(false, 'Missing cell');
            return;
        }
        // Disable animation for Android when screen reader is on.
        // This is needed to make sure screen reader order is correct.
        var animate = animateIfPreviouslyVisible && cellInfo.isVisible && !this._isAndroidScreenReaderEnabled();
        cellInfo.isVisible = isVisibile;
        cellInfo.top = top;
        // Set the "live" values as well.
        var cell = cellInfo.cellRef.current;
        if (cell) {
            cell.setVisibility(isVisibile);
            cell.setTop(top, animate);
        }
    };
    VirtualListView.prototype._isCellVisible = function (itemKey) {
        var cellInfo = this._activeCells.get(itemKey);
        return (!!cellInfo && cellInfo.isVisible);
    };
    VirtualListView.prototype.render = function () {
        var itemsRendered = [];
        this._navigatableItemsRendered = [];
        if (this.props.logInfo) {
            this.props.logInfo('Rendering ' + this._itemsInRenderBlock + ' Items...');
        }
        // Build a list of all the cells we're going to render. This includes all of the active
        // cells plus any recycled (offscreen) cells.
        var cellList = [];
        for (var i = 0; i < this._itemsInRenderBlock; i++) {
            var itemIndex = this._itemsAboveRenderBlock + i;
            var item = this.props.itemList[itemIndex];
            var virtualCellInfo = this._activeCells.get(item.key);
            assert_1.default(virtualCellInfo, 'Active Cell not found for key ' + item.key + ', index=' + i);
            cellList.push({
                cellInfo: virtualCellInfo,
                item: item,
                itemIndex: itemIndex,
            });
            if (item.isNavigable) {
                this._navigatableItemsRendered.push({ key: item.key, vc_key: virtualCellInfo.virtualKey });
            }
        }
        for (var _i = 0, _a = this._recycledCells; _i < _a.length; _i++) {
            var virtualCellInfo = _a[_i];
            assert_1.default(virtualCellInfo, 'Recycled Cells array contains a null/undefined object');
            cellList.push({
                cellInfo: virtualCellInfo,
                item: undefined,
                itemIndex: undefined,
            });
        }
        // Sort the list of cells by virtual key so the order doesn't change. Otherwise
        // the underlying render engine (the browser or React Native) treat it as a DOM
        // change, and perf suffers.
        cellList = cellList.sort(function (a, b) { return a.cellInfo.virtualKey < b.cellInfo.virtualKey ? 1 : -1; });
        var focusIndex;
        if (this.state.lastFocusedItemKey === undefined) {
            var itemToFocus = _.minBy(cellList, function (cell) {
                if (!cell.item || !cell.item.isNavigable) {
                    return Number.MAX_VALUE;
                }
                return cell.itemIndex;
            });
            if (itemToFocus) {
                focusIndex = itemToFocus.itemIndex;
            }
        }
        for (var _b = 0, cellList_1 = cellList; _b < cellList_1.length; _b++) {
            var cell = cellList_1[_b];
            var tabIndexValue = -1;
            var isFocused = false;
            var isSelected = false;
            if (cell.item) {
                if (cell.item.isNavigable) {
                    if (cell.itemIndex === focusIndex) {
                        tabIndexValue = 0;
                    }
                    else {
                        tabIndexValue = cell.item.key === this.state.lastFocusedItemKey ? 0 : -1;
                    }
                    if (cell.item.key === this.state.selectedItemKey) {
                        isSelected = true;
                    }
                }
                if (cell.item.key === this.state.lastFocusedItemKey) {
                    isFocused = true;
                }
            }
            // We disable transform in Android because it creates problem for screen reader order.
            // We update the keys in order to make sure we re-render cells, as once we enable native animation for a view.
            // We can't disable it.
            itemsRendered.push(RX.createElement(VirtualListCell_1.VirtualListCell, { ref: cell.cellInfo.cellRef, key: this._isAndroidScreenReaderEnabled() ? _accessibilityVirtualKeyPrefix +
                    cell.cellInfo.virtualKey : cell.cellInfo.virtualKey, onLayout: !cell.cellInfo.isHeightConstant ? this._onLayoutItem : undefined, onAnimateStartStop: this._onAnimateStartStopItem, itemKey: cell.item ? cell.item.key : undefined, item: cell.item, left: 0, width: this._contentWidth, top: cell.cellInfo.top, isVisible: cell.cellInfo.isVisible, isActive: cell.item ? true : false, isFocused: isFocused, isSelected: isSelected, tabIndex: tabIndexValue, onItemFocused: this._onItemFocused, onItemSelected: this._onItemSelected, shouldUpdate: !this.props.skipRenderIfItemUnchanged || cell.cellInfo.shouldUpdate, showOverflow: this.props.showOverflow, isScreenReaderModeEnabled: this._isAndroidScreenReaderEnabled(), renderItem: this.props.renderItem, onKeyPress: this._onKeyDown }));
            cell.cellInfo.shouldUpdate = false;
        }
        if (this.props.logInfo) {
            // [NOTE: For debugging] This shows the order in which virtual cells are laid out.
            var domOrder = _.map(cellList, function (c) {
                var itemKey = c.item ? c.item.key : null;
                var itemIndex = c.item ? c.itemIndex : null;
                return 'vKey: ' + c.cellInfo.virtualKey + ' iKey: ' + itemKey + ' iIdx: ' + itemIndex;
            }).join('\n');
            this.props.logInfo(domOrder);
            this.props.logInfo('Item Render Complete');
        }
        var scrollViewStyle = [_styles.scrollContainer];
        var staticContainerStyle = [_styles.staticContainer];
        if (this.props.style) {
            if (Array.isArray(this.props.style)) {
                staticContainerStyle = staticContainerStyle.concat(this.props.style);
            }
            else {
                staticContainerStyle.push(this.props.style);
            }
        }
        staticContainerStyle.push(this._containerAnimatedStyle);
        return (RX.createElement(RX.ScrollView, { ref: this._scrollViewRef, testId: this.props.testId, onLayout: this._onLayoutContainer, onScroll: this._onScroll, scrollXAnimatedValue: this.props.scrollXAnimatedValue, scrollYAnimatedValue: this.props.scrollYAnimatedValue, keyboardDismissMode: this.props.keyboardDismissMode, keyboardShouldPersistTaps: this.props.keyboardShouldPersistTaps, scrollsToTop: this.props.scrollsToTop, scrollEventThrottle: this.props.scrollEventThrottle || 32, style: scrollViewStyle, bounces: !this.props.disableBouncing, onKeyPress: this._onKeyDown, scrollEnabled: !this.props.disableScrolling, scrollIndicatorInsets: this.props.scrollIndicatorInsets },
            RX.createElement(RX.Animated.View, { style: staticContainerStyle }, itemsRendered)));
    };
    // Sets selection & focus to specified key
    VirtualListView.prototype.selectItemKey = function (key, scrollToItem) {
        if (scrollToItem === void 0) { scrollToItem = true; }
        // Set focus and selection
        this.setState({
            lastFocusedItemKey: key,
            selectedItemKey: key,
        });
        if (scrollToItem) {
            this._scrollToItemKey(key);
        }
    };
    VirtualListView.prototype._scrollToItemKey = function (key) {
        var indexToSelect;
        _.each(this.props.itemList, function (item, idx) {
            if (item.key === key) {
                indexToSelect = idx;
                return true;
            }
        });
        if (indexToSelect !== undefined) {
            this._scrollToItemIndex(indexToSelect);
        }
    };
    VirtualListView.prototype._scrollToItemIndex = function (index) {
        this.scrollToTop(false, this._calcHeightOfItems(this.props, 0, index - 1) - (this.props.keyboardFocusScrollOffset || 0));
    };
    // Returns true if successfully found/focused, false if not found/focused
    VirtualListView.prototype._focusSubsequentItem = function (direction, viaKeyboard, retry) {
        var _this = this;
        if (retry === void 0) { retry = true; }
        var index = _.findIndex(this._navigatableItemsRendered, function (item) { return item.key === _this.state.lastFocusedItemKey; });
        if (index !== -1 && index + direction > -1 && index + direction < this._navigatableItemsRendered.length) {
            var newFocusKey = this._navigatableItemsRendered[index + direction].key;
            var cellForFocus = this._activeCells.get(newFocusKey);
            if (cellForFocus && cellForFocus.cellRef.current) {
                var newElementForFocus = cellForFocus.cellRef.current;
                newElementForFocus.focus();
                if (viaKeyboard && newElementForFocus.props.itemKey) {
                    this._scrollToItemKey(newElementForFocus.props.itemKey);
                }
            }
            return true;
        }
        if (index === -1 && retry && this.state.lastFocusedItemKey !== undefined) {
            index = this._itemMap.get(this.state.lastFocusedItemKey);
            if (index === undefined) {
                assert_1.default(false, 'Something went wrong in finding last focused item');
                return false;
            }
            var height = index === 0 ? 0 : this._calcHeightOfItems(this.props, 0, index - 1);
            this.scrollToTop(false, height);
            this._pendingFocusDirection = direction;
            return true;
        }
        return false;
    };
    VirtualListView.prototype.componentDidMount = function () {
        RX.Accessibility.screenReaderChangedEvent.subscribe(this._screenReaderStateChanged);
        if (RX.Accessibility.isScreenReaderEnabled()) {
            this._setupForAccessibility();
        }
        this._isMounted = true;
        this._componentDidRender();
        // If an initial selection key was provided, ensure that we scroll to the item
        if (this.props.initialSelectedKey) {
            this._scrollToItemKey(this.props.initialSelectedKey);
        }
    };
    VirtualListView.prototype.componentWillUnmount = function () {
        this._isMounted = false;
        RX.Accessibility.screenReaderChangedEvent.unsubscribe(this._screenReaderStateChanged);
    };
    VirtualListView.prototype.componentDidUpdate = function (prevProps) {
        this._componentDidRender();
    };
    VirtualListView.prototype._componentDidRender = function () {
        var _this = this;
        if (this.props.logInfo) {
            this.props.logInfo('Component Did Render');
        }
        this._isRenderDirty = false;
        // If we don't defer this, we can end up overflowing the stack
        // because one render immediately causes another render to be started.
        _.defer(function () {
            if (_this._isMounted) {
                _this._calcNewRenderedItemState(_this.props);
                _this._renderIfDirty(_this.props);
                _this._reconcileCorrections(_this.props);
                _this._setFocusIfNeeded();
            }
        });
    };
    // If there was a pending focus setting before we re-rendered, set the same.
    VirtualListView.prototype._setFocusIfNeeded = function () {
        if (this._pendingFocusDirection) {
            this._focusSubsequentItem(this._pendingFocusDirection, false, false /* do not retry if this fails */);
            this._pendingFocusDirection = undefined;
        }
    };
    // Local helper functions for item information
    VirtualListView.prototype._shouldShowItem = function (item, props) {
        var isMeasuring = !this._isItemHeightKnown(item);
        var shouldHide = isMeasuring || !this._isInitialFillComplete;
        return !shouldHide;
    };
    VirtualListView.prototype._calcHeightOfItems = function (props, startIndex, endIndex) {
        var count = 0;
        for (var i = startIndex; i <= endIndex; i++) {
            count += this._getHeightOfItem(props.itemList[i]);
        }
        return count;
    };
    VirtualListView.prototype._isItemHeightKnown = function (item) {
        return !item.measureHeight || this._heightCache.has(item.key);
    };
    VirtualListView.prototype._getHeightOfItem = function (item) {
        if (!item) {
            return 0;
        }
        // See if the item height was passed as "known"
        if (!item.measureHeight) {
            return item.height;
        }
        // See if we have it cached
        var cachedHeight = this._heightCache.get(item.key);
        if (cachedHeight !== undefined) {
            return cachedHeight;
        }
        // Nope -- use guess given to us
        return item.height;
    };
    // Next cell key. We keep incrementing this value so we always generate unique keys.
    VirtualListView._nextCellKey = 1;
    return VirtualListView;
}(RX.Component));
exports.VirtualListView = VirtualListView;
