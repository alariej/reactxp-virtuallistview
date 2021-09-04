"use strict";
/**
 * VirtualListCell.tsx
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT license.
 *
 * This helper class is used in conjunction with VirtualListView. It represents the
 * container for a single list item.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VirtualListCell = void 0;
var tslib_1 = require("tslib");
var react_1 = require("react");
var RX = require("reactxp");
var assert_1 = require("./assert");
var _styles = {
    cellView: RX.Styles.createViewStyle({
        position: 'absolute',
    }),
    overflowVisible: RX.Styles.createViewStyle({
        overflow: 'visible',
    }),
    overflowHidden: RX.Styles.createViewStyle({
        overflow: 'hidden',
    }),
};
var _isNativeMacOS = RX.Platform.getType() === 'macos';
var _keyCodeEnter = 13;
var _keyCodeSpace = 32;
var _keyCodeReturn = 3;
var VirtualListCell = /** @class */ (function (_super) {
    tslib_1.__extends(VirtualListCell, _super);
    function VirtualListCell(props) {
        var _this = _super.call(this, props) || this;
        _this._isVisible = false;
        _this._top = VirtualListCell._hiddenTopValue;
        _this._calculatedHeight = 0;
        _this._ref = react_1.createRef();
        _this._onKeyPress = function (e) {
            var isSelectItemKeyPress = e.keyCode === _keyCodeEnter ||
                e.keyCode === _keyCodeSpace ||
                e.keyCode === _keyCodeReturn;
            if (isSelectItemKeyPress && _this.props.onItemSelected && _this.props.item) {
                _this.props.onItemSelected(_this.props.item);
                e.stopPropagation();
            }
            if (_this.props.onKeyPress) {
                _this.props.onKeyPress(e);
            }
        };
        _this._onFocus = function (e) {
            if (_this.props.onItemFocused) {
                _this.props.onItemFocused(_this.props.item);
            }
        };
        _this._onPress = function (e) {
            if (_this.props.onItemSelected && _this.props.item) {
                _this.props.onItemSelected(_this.props.item);
                e.stopPropagation();
            }
        };
        _this._onBlur = function (e) {
            if (_this.props.onItemFocused) {
                _this.props.onItemFocused(undefined);
            }
        };
        _this._onLayout = function (layoutInfo) {
            if (_this.props.onLayout && _this.props.isActive && _this._itemKey) {
                _this._calculatedHeight = layoutInfo.height;
                _this.props.onLayout(_this._itemKey, layoutInfo.height);
            }
        };
        _this._isVisible = props.isVisible;
        _this._top = props.top;
        _this._itemKey = props.itemKey;
        var topValue = _this._isVisible ? _this._top : VirtualListCell._hiddenTopValue;
        _this._topValue = RX.Animated.createValue(topValue);
        if (!props.isScreenReaderModeEnabled && !_isNativeMacOS) {
            // On native platforms, we'll stick with translate[X|Y] because it has a performance advantage.
            _this._animatedStylePosition = RX.Styles.createAnimatedViewStyle({
                transform: [{
                        translateY: _this._topValue,
                    }]
            });
        }
        else {
            // We need to work around an IE-specific bug. It doesn't properly handle
            // translateY in this case. In particular, if separate translations are used
            // within the item itself, it doesn't handle that combination.
            _this._animatedStylePosition = RX.Styles.createAnimatedViewStyle({
                top: _this._topValue
            });
        }
        _this._staticStylePosition = RX.Styles.createViewStyle({
            width: _this.props.width,
        }, false);
        return _this;
    }
    VirtualListCell.prototype.UNSAFE_componentWillReceiveProps = function (nextProps) {
        // If it's inactive, it had better be invisible.
        assert_1.default(nextProps.isActive || !nextProps.isVisible);
        // All callbacks should be prebound to optimize performance.
        assert_1.default(this.props.onLayout === nextProps.onLayout, 'onLayout callback changed');
        assert_1.default(this.props.onItemSelected === nextProps.onItemSelected, 'onItemSelected callback changed');
        assert_1.default(this.props.onItemFocused === nextProps.onItemFocused, 'onItemFocused callback changed');
        assert_1.default(this.props.onAnimateStartStop === nextProps.onAnimateStartStop, 'onAnimateStartStop callback changed');
        assert_1.default(this.props.renderItem === nextProps.renderItem, 'renderItem callback changed');
        // We assume this prop doesn't change for perf reasons. Callers should modify
        // the key to force an unmount/remount if these need to change.
        assert_1.default(this.props.isScreenReaderModeEnabled === nextProps.isScreenReaderModeEnabled);
        this.setItemKey(nextProps.itemKey);
        if (this.props.itemKey !== nextProps.itemKey) {
            this.setVisibility(nextProps.isVisible);
            this.setTop(nextProps.top);
        }
    };
    VirtualListCell.prototype.shouldComponentUpdate = function (nextProps) {
        // No need to update inactive (recycled) cells.
        if (!nextProps.isActive) {
            return false;
        }
        // Check if props important for rendering changed.
        if (this.props.tabIndex !== nextProps.tabIndex ||
            this.props.itemKey !== nextProps.itemKey ||
            this.props.isFocused !== nextProps.isFocused ||
            this.props.isSelected !== nextProps.isSelected) {
            return true;
        }
        return nextProps.shouldUpdate;
    };
    VirtualListCell.prototype.componentDidUpdate = function (prevProps) {
        // We need to simulate a layout event here because recycled cells may not
        // generate a layout event if the cell contents haven't changed.
        if (this.props.onLayout && this.props.isActive && this._calculatedHeight && this._itemKey) {
            this.props.onLayout(this._itemKey, this._calculatedHeight);
        }
    };
    VirtualListCell.prototype.componentWillUnmount = function () {
        // Stop any pending animation.
        if (this._topAnimation) {
            this._topAnimation.stop();
        }
    };
    VirtualListCell.prototype.setVisibility = function (isVisible) {
        if (isVisible !== this._isVisible) {
            this._isVisible = isVisible;
            if (this._topAnimation) {
                this._topAnimation.stop();
            }
            this._topValue.setValue(this._isVisible ? this._top : VirtualListCell._hiddenTopValue);
        }
    };
    VirtualListCell.prototype.isVisible = function () {
        return this._isVisible;
    };
    VirtualListCell.prototype.setTop = function (top, animate) {
        var _this = this;
        if (animate === void 0) { animate = false; }
        if (top !== this._top) {
            this._top = top;
            if (this._isVisible) {
                var isReplacingPendingAnimation = false;
                // Stop any pending animation.
                if (this._topAnimation) {
                    var animationToCancel = this._topAnimation;
                    // The call to stop() will invoke the stop callback. If we are
                    // going to replace a pending animation, we'll make it look like
                    // a continuous animation rather than calling the callback multiple
                    // times. If we're not replacing the animation with another animation,
                    // allow the onAnimateStartStop to proceed.
                    if (animate) {
                        this._topAnimation = undefined;
                    }
                    animationToCancel.stop();
                    isReplacingPendingAnimation = true;
                }
                if (animate) {
                    this._topAnimation = RX.Animated.timing(this._topValue, {
                        toValue: top,
                        duration: 200,
                        easing: RX.Animated.Easing.InOut(),
                        useNativeDriver: true,
                    });
                    if (!isReplacingPendingAnimation && this.props.onAnimateStartStop && this._itemKey) {
                        this.props.onAnimateStartStop(this._itemKey, true);
                    }
                    this._topAnimation.start(function () {
                        // Has the animation been canceled?
                        if (_this._topAnimation) {
                            _this._topAnimation = undefined;
                            if (_this.props.onAnimateStartStop && _this._itemKey) {
                                _this.props.onAnimateStartStop(_this._itemKey, false);
                            }
                        }
                    });
                }
                else {
                    this._topValue.setValue(top);
                }
            }
        }
    };
    VirtualListCell.prototype.cancelPendingAnimation = function () {
        if (this._topAnimation) {
            this._topAnimation.stop();
        }
    };
    VirtualListCell.prototype.setItemKey = function (key) {
        this._itemKey = key;
    };
    VirtualListCell.prototype.getTop = function () {
        return this._top;
    };
    VirtualListCell.prototype.focus = function () {
        if (this._ref.current && this.props.tabIndex) {
            var virtualCellComponent = this._ref.current;
            virtualCellComponent.focus();
        }
    };
    VirtualListCell.prototype.render = function () {
        var overflow = this.props.showOverflow ? _styles.overflowVisible : _styles.overflowHidden;
        return (RX.createElement(RX.Animated.View, { style: [_styles.cellView, overflow, this._animatedStylePosition, this._staticStylePosition], ref: this._ref, tabIndex: this.props.tabIndex, onLayout: this.props.onLayout ? this._onLayout : undefined, onFocus: this.props.onItemFocused ? this._onFocus : undefined, onBlur: this.props.onItemFocused ? this._onBlur : undefined, onPress: this.props.onItemSelected ? this._onPress : undefined, onKeyPress: this.props.onKeyPress || typeof (this.props.onItemSelected) === 'function' ? this._onKeyPress : undefined, disableTouchOpacityAnimation: this.props.item ? this.props.item.disableTouchOpacityAnimation : undefined },
            RX.createElement(VirtualListCell.StaticRenderer, { shouldUpdate: this.props.shouldUpdate, isFocused: this.props.isFocused, isSelected: this.props.isSelected, item: this.props.item, renderItem: this.props.renderItem })));
    };
    // Helper class used to render child elements. If we know that none of the children changed - we would like to skip
    // the render completely, to improve performance.
    // eslint-disable-next-line @typescript-eslint/member-naming
    VirtualListCell.StaticRenderer = /** @class */ (function (_super) {
        tslib_1.__extends(class_1, _super);
        function class_1(props) {
            return _super.call(this, props) || this;
        }
        class_1.prototype.shouldComponentUpdate = function (nextProps) {
            return nextProps.shouldUpdate ||
                this.props.isFocused !== nextProps.isFocused ||
                this.props.isSelected !== nextProps.isSelected;
        };
        class_1.prototype.render = function () {
            // If we don't have an item to render, return null here
            if (!this.props.item) {
                return null;
            }
            return (RX.createElement(RX.Fragment, null, this.props.renderItem({
                item: this.props.item,
                selected: this.props.isSelected,
                focused: this.props.isFocused,
            })));
        };
        return class_1;
    }(RX.Component));
    VirtualListCell._hiddenTopValue = -32768;
    return VirtualListCell;
}(RX.Component));
exports.VirtualListCell = VirtualListCell;
