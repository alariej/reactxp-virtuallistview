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
import { RefObject } from 'react';
import * as RX from 'reactxp';
import { VirtualListCell, VirtualListCellInfo, VirtualListCellRenderDetails } from './VirtualListCell';
export interface VirtualListViewItemInfo extends VirtualListCellInfo {
    height: number;
    measureHeight?: boolean;
    template?: string;
    isNavigable?: boolean;
}
export interface VirtualListViewCellRenderDetails<T extends VirtualListViewItemInfo> extends VirtualListCellRenderDetails<T> {
}
export interface VirtualListViewProps<ItemInfo extends VirtualListViewItemInfo> extends RX.CommonStyledProps<RX.Types.ViewStyleRuleSet, VirtualListView<ItemInfo>> {
    testId?: string;
    itemList: ItemInfo[];
    renderItem: (renderDetails: VirtualListCellRenderDetails<ItemInfo>) => JSX.Element | JSX.Element[];
    onItemSelected?: (item: ItemInfo) => void;
    onItemFocused?: (item: ItemInfo | undefined) => void;
    initialSelectedKey?: string;
    padding?: number;
    showOverflow?: boolean;
    animateChanges?: boolean;
    skipRenderIfItemUnchanged?: boolean;
    keyboardDismissMode?: 'none' | 'interactive' | 'on-drag';
    keyboardShouldPersistTaps?: boolean;
    disableScrolling?: boolean;
    scrollsToTop?: boolean;
    disableBouncing?: boolean;
    scrollIndicatorInsets?: {
        top: number;
        left: number;
        bottom: number;
        right: number;
    };
    scrollEventThrottle?: number;
    onScroll?: (scrollTop: number, scrollLeft: number) => void;
    onLayout?: (e: RX.Types.ViewOnLayoutEvent) => void;
    scrollXAnimatedValue?: RX.Types.AnimatedValue;
    scrollYAnimatedValue?: RX.Types.AnimatedValue;
    keyboardFocusScrollOffset?: number;
    logInfo?: (textToLog: string) => void;
}
export interface VirtualListViewState {
    lastFocusedItemKey?: string;
    isFocused?: boolean;
    selectedItemKey?: string;
}
export interface VirtualCellInfo<ItemInfo extends VirtualListViewItemInfo> {
    cellRef: RefObject<VirtualListCell<ItemInfo>>;
    virtualKey: string;
    itemTemplate?: string;
    isHeightConstant: boolean;
    height: number;
    cachedItemKey: string;
    top: number;
    isVisible: boolean;
    shouldUpdate: boolean;
}
export declare class VirtualListView<ItemInfo extends VirtualListViewItemInfo> extends RX.Component<VirtualListViewProps<ItemInfo>, VirtualListViewState> {
    private _lastScrollTop;
    private _layoutHeight;
    private _layoutWidth;
    private _contentWidth;
    private _isMounted;
    private _containerHeight;
    private _containerHeightValue;
    private _containerAnimatedStyle;
    private _itemMap;
    private _scrollViewRef;
    private _isRenderDirty;
    private _pendingAnimations;
    private _heightAboveRenderAdjustment;
    private _heightAboveRenderBlock;
    private _heightOfRenderBlock;
    private _heightBelowRenderBlock;
    private _itemsAboveRenderBlock;
    private _itemsInRenderBlock;
    private _itemsBelowRenderBlock;
    private _pendingMeasurements;
    private _isInitialFillComplete;
    private _heightCache;
    private static _nextCellKey;
    private _activeCells;
    private _recycledCells;
    private _navigatableItemsRendered;
    private _pendingFocusDirection;
    private _maxRecycledCells;
    private _isScreenReaderEnabled;
    private _renderOverdrawFactor;
    private _minOverdrawAmount;
    private _maxOverdrawAmount;
    private _cullFraction;
    private _minCullAmount;
    constructor(props: VirtualListViewProps<ItemInfo>);
    UNSAFE_componentWillReceiveProps(nextProps: VirtualListViewProps<ItemInfo>): void;
    UNSAFE_componentWillUpdate(nextProps: VirtualListViewProps<ItemInfo>, nextState: VirtualListViewState): void;
    private _setupForAccessibility;
    private _tearDownForAccessibility;
    private _isAndroidScreenReaderEnabled;
    private _updateStateFromProps;
    private _handleItemListChange;
    private _calcOverdrawAmount;
    private _onLayoutContainer;
    private _onLayoutItem;
    private _onAnimateStartStopItem;
    private _onScroll;
    private _calcNewRenderedItemState;
    private _reconcileCorrections;
    private _popInvisibleIntoView;
    private _resizeAllItems;
    private _renderIfDirty;
    private _allocateCell;
    private _recycleCell;
    private _setCellTopAndVisibility;
    private _isCellVisible;
    scrollToTop: (animated?: boolean, top?: number) => void;
    render(): JSX.Element;
    private _onItemFocused;
    selectItemKey(key: string, scrollToItem?: boolean): void;
    private _onItemSelected;
    private _onKeyDown;
    private _scrollToItemKey;
    private _scrollToItemIndex;
    private _focusSubsequentItem;
    private _screenReaderStateChanged;
    componentDidMount(): void;
    componentWillUnmount(): void;
    componentDidUpdate(prevProps: VirtualListViewProps<ItemInfo>): void;
    protected _componentDidRender(): void;
    private _setFocusIfNeeded;
    private _shouldShowItem;
    private _calcHeightOfItems;
    private _isItemHeightKnown;
    private _getHeightOfItem;
}
