import * as $ from "jquery";
import * as stringify from "json-stable-stringify";

import { Features } from "./utils/features";
import GenericFeatureSet = Features.GenericFeatureSet;
import FeatureSet = Features.FeatureSet;
import TableFeatureSet = Features.TableFeatureSet;
import PulldownFeatureSet = Features.PulldownFeatureSet;

import { MainpanelNodeRep } from "./handlers/scrape_mode_handlers";

import { XPath } from "./utils/xpath";
import SuffixXPathList = XPath.SuffixXPathList;
import { LikelyRelationMessageContent, FreshRelationItemsMessage } from "../common/messages";

export interface ColumnSelector {
  xpath: string;
  suffix: SuffixXPathList | SuffixXPathList[];
  name?: string;
  id: number | null;
  index?: number;
}

interface NextButtonSelector {
  id: string;
  class: string;
  src: string | null;
  frame_id: string | null;
  tag: string;
  text: string | null;
  xpath: string;
}

export interface GenericSelector {
  selector_version: number;
  selector: GenericFeatureSet | GenericFeatureSet[];
  name?: string | null;
  exclude_first: number;
  id?: number;
  columns: ColumnSelector[];
  num_rows_in_demonstration?: number;
  next_type?: number;
  prior_next_button_text?: string;
  next_button_selector?: NextButtonSelector | null;
  url?: string;
  
  positive_nodes?: Element[];
  negative_nodes?: Element[];

  relation?: ((Element | MainpanelNodeRep | null)[][]) | null;
  page_var_name?: string;
  relation_id?: number | null;
  first_page_relation?: (Element | MainpanelNodeRep | null)[][];
  pulldown_relations?: GenericSelector[];

  relation_scrape_wait?: number;
}

export interface ContentSelector extends GenericSelector {
  relation: (Element | null)[][];
  editingClickColumnIndex?: number;
  origSelector?: ContentSelector;
  currentIndividualSelector?: ContentSelector;
}

export interface MainpanelSelector extends GenericSelector {
  relation: (MainpanelNodeRep[][]) | null;
  demonstration_time_relation?: MainpanelNodeRep[][];
}

export interface ScrapedElement extends Element {
  ___relationFinderId___?: number;
}

/**
 * Selector with additional metadata for selecting the "best" selector.
 */ 
export interface ComparisonSelector extends GenericSelector {
  relation: MainpanelNodeRep[][];
  numMatchedXpaths: number;
  numRows: number;
  numRowsInDemo: number;
  numColumns: number;
}

export namespace RelationFinder {

  /**********************************************************************
   * Web-specific relation-finder code -- how to get features, how to tell when features match, how to combine features to get a more general feature, all candidates
   **********************************************************************/

  /**
   * Get cells in each of the candidateRowNodes matching the suffixes.
   * @param suffixes the tail end of each XPath for a column, which excludes the
   *   XPath up to the row element
   * @param candidateRowNodes candidate row nodes, or null if none found  
   */
  function getCellsInRowMatchingSuffixes(
      suffixes: SuffixXPathList | SuffixXPathList[],
      candidateRowNodes: (Element | null)[]) {
    let candidateSubitems = [];
    let rowNodeXPaths = candidateRowNodes.map(
      (candidateRow) => OldXPathList.xPathToXPathList(nodeToXPath(candidateRow))
    );
    for (let j = 0; j < suffixes.length; j++){
      // TODO: clean this up
      // suffixes[j] will be depth 2 if only one suffix available,
      // depth 3 if list of suffixes available
      let suffixLs: SuffixXPathList[];
      // < 3 rather than = 2 because we use empty suffix for single-col datasets
      if (window.MiscUtilities.depthOf(suffixes[j]) < 3){ 
        suffixLs = [ <SuffixXPathList> suffixes[j] ];
      } else {
        suffixLs = <SuffixXPathList[]> suffixes[j];
      }

      let foundSubItem = null;
      for (let k = 0; k < suffixLs.length; k++){
        let rowNodeXPath = null;
        let suffixListRep = null;
        let selectorIndex = suffixLs[k].selectorIndex;

        // selectorIndex can be 0, which is why we check for undefined
        if (selectorIndex !== undefined) {
          // we know exactly which of the candidate row nodes to use because a
          //   selector index is provided
          rowNodeXPath = rowNodeXPaths[selectorIndex];
          suffixListRep = suffixLs[k].suffixRepresentation;
        } else {
          // this suffix isn't one of our selectorIndex-labeled objects. it is
          //   the old array representation so we should have only one selector
          //   and thus only one candidate row node
          rowNodeXPath = rowNodeXPaths[0];
          suffixListRep = suffixLs[k];
          if (candidateRowNodes.length > 1){
            window.WALconsole.warn("Woah, bad, we have no selector index associated " +
              "with a column suffix, but we have multiple row nodes.");
          }
        }
        let xpath = rowNodeXPath.concat(suffixListRep);
        let xpath_string = OldXPathList.xPathToString(xpath);
        let nodes = <Element[]> xPathToNodes(xpath_string);
        if (nodes.length > 0){
          foundSubItem = nodes[0];
          break;
        }
      }
      // either push the found subitem, or null if none found
      candidateSubitems.push(foundSubItem);
    }
    let atLeastOneNonNullCandidate = candidateSubitems.some((item) => item);
    if (candidateSubitems.length > 0 && atLeastOneNonNullCandidate){
      return candidateSubitems;
    }
    return null;
  }

  /**
   * Retrieve all candidate elements from the document.
   */
  function getAllCandidateElements() {
    return document.getElementsByTagName("*");
  }

  /**********************************************************************
   * Domain-independent function to go from a selector to a relation of elements
   **********************************************************************/

  /**
   * Gets the document elements matching the features specified in selector for
   *   the general, non-table case.
   * @param selector the selector specifying features
   * @param excludeFirst exclude this many rows from extraction (e.g. headers)
   */
  export function getElementsMatchingRelationSelector(
    selector: FeatureSet, excludeFirst: number) {
    // window.WALconsole.log("interpretRelationSelectorHelper", feature_dict,
    //   excludeFirst, subcomponents_function);
    let candidates = getAllCandidateElements();
    let listOfRowNodes = [];
    for (let i = 0; i < candidates.length; i++) {
      let candidate = candidates[i];
      let candidate_ok = true;
      for (const feature in selector) {
        let value = Features.computeFeatureFromElement(candidate, feature);
        let acceptable_values = selector[feature].values;
        let pos = selector[feature].pos;
        let candidate_feature_match = Features.featureMatches(feature, value,
          acceptable_values);
        if ((pos && !candidate_feature_match) ||
           (!pos && candidate_feature_match)) {
          candidate_ok = false;
          break;
        }
      }
      if (candidate_ok) {
        listOfRowNodes.push(candidate);
      }
    }
    if (excludeFirst > 0 && listOfRowNodes.length > excludeFirst){
      return listOfRowNodes.slice(excludeFirst, listOfRowNodes.length);
    }
    window.WALconsole.log("listOfRowNodes", listOfRowNodes);
    return listOfRowNodes;
  };


  /**
   * Gets the document elements matching the features specified in selector for
   *   a table element.
   * @param selector the selector specifying features
   * @param excludeFirst exclude this many rows from extraction (e.g. headers)
   */
  export function getElementsMatchingTableSelector(selector: TableFeatureSet,
    excludeFirst: number) {
    // we don't use this for nested tables! this is just for very simple tables,
    //   otherwise we'd graduate to the standard approach
    let nodes = xPathToNodes(selector.xpath);
    let table = null;
    if (nodes.length > 0) {
      // awesome, we have something at the exact xpath
      table = <Element> nodes[0];
    } else {
      // ok, I guess we'll have to see which table on the page is closest
      let tables = [].slice.call(document.getElementsByTagName("table"));
      let bestTableScore = Number.POSITIVE_INFINITY;

      for (const t of tables) {
        let distance = window.MiscUtilities.levenshteinDistance(nodeToXPath(t),
          selector.xpath);
        if (distance < bestTableScore){
          bestTableScore = distance;
          table = t;
        }
      }
    }

    // ok, now we know which table to use

    if (table === null) {
      throw new ReferenceError(`Could not find table matching ${JSON.stringify(selector)}`);
      // todo: why is this arising?
      // return []; 
    }

    let rows = [].slice.call(table.querySelectorAll("tr"));
    rows = rows.slice(excludeFirst, rows.length);
    return rows;
  };

  /**
   * Gets elements representing the rows of the relation to be extracted.
   * @param selector the selector specifying what elements to match
   */
  export function getRowsMatchingSelector(selector: GenericSelector): Element[][] {
    if (!selector.selector){
      return [];
    }

    if (Array.isArray(selector.selector)){
      // the case where we need to recurse
      let selectorArray = selector.selector;
      let rowNodeLists: Element[][] = [];
      for (let i = 0; i < selectorArray.length; i++){
        let possibleSelector = selectorArray[i];
        selector.selector = possibleSelector;
        let newRowNodesLs = getRowsMatchingSelector(selector);
        rowNodeLists = rowNodeLists.concat(newRowNodesLs);
      }
      selector.selector = selectorArray;
      return rowNodeLists;
    }

    window.WALconsole.log("interpretRelationSelector", selector);

    if ('table' in selector.selector &&
        (<TableFeatureSet> selector.selector).table) {
      // special case: table extractor
      return [ getElementsMatchingTableSelector(
        <TableFeatureSet> selector.selector, selector.exclude_first) ];
    } else {
      // the normal extractor
      return [ getElementsMatchingRelationSelector(
        <FeatureSet> selector.selector, selector.exclude_first) ];
    }
  }

  /**
   * Get all the cells to be extracted given multiple rows where each row is
   *   extracted from a selector.
   * @param selector selector specifying what elements to match
   * @param rowsPerSelector for each selector, a collection of nodes where each
   *   node represents a row
   */
  export function getCellsMatchingSelector(selector: GenericSelector,
    rowsPerSelector: Element[][]) {
    window.WALconsole.log("rowNodeLists", rowsPerSelector);
    // now we'll use the columns info to actually get the cells
    let suffixes = selector.columns.map((col) => col.suffix);
    
    // only use multiple selectors up to the point where they have the same
    //   number of rows
    let allCells = [];
    let maxRowCount = Math.max(...(rowsPerSelector.map(rows => rows.length)));
    for (let rowIndex = 0; rowIndex < maxRowCount; rowIndex++) {
      let curRowNodes = [];
      for (let selIndex = 0; selIndex < rowsPerSelector.length; selIndex++) {
        if (rowsPerSelector[selIndex].length > rowIndex) {
          curRowNodes.push(rowsPerSelector[selIndex][rowIndex]);
        } else {
          curRowNodes.push(null);
        }
      }
      let curRowCells = getCellsInRowMatchingSuffixes(suffixes, curRowNodes);
      if (curRowCells !== null) {
        allCells.push(curRowCells);
      }
    }
    return allCells;
  }

  /**
   * cjbaik: Not sure what this does, or if it is even ever called.
   * @param selector 
   */
  export function interpretPulldownSelector(selector: PulldownFeatureSet) {
    let allSelectNodes = document.getElementsByTagName("select");
    // then just index into it, because our current approach to pulldowns is
    //   crazy simplistic
    let selectorNode = allSelectNodes[selector.index];
    console.log("selector: ", selector, selector.index, selectorNode);
    if (!selectorNode.disabled) {
      console.log("selector enabled");
      let optionNodes = [].slice.call(selectorNode.querySelectorAll("option"));
      console.log("option nodes", optionNodes);
      return optionNodes;
    }
    console.log("selector not enabled");
    // else, we know which pulldown we want, but it's disabled right now.
    //   let's wait
    return [];
  }

  /* a wrapper function that goes through and tosses cells/rows
     that are display:none
  function onlyDisplayedCellsAndRows(rows){
    var outputRows = [];
    for (var i = 0; i < rows.length; i++){
      var cells = rows[i];
      var allCellsInvisible = true;
      for (var j = 0; j < cells.length; j++){
        if ($(cells[j]).is(":visible")){
          allCellsInvisible = false;
        }
        else{
          // huh, it is invisible.  ok, null it out
          cells[j] = null;
        }
      }
      if (!allCellsInvisible){
        outputRows.push(cells);
      }
    }
    return outputRows;
  }*/

  /**
   * Get a relation from the document given the selector.
   * @param selector selector describing the relation to retrieve
   * @returns a relation (i.e. a 2d array) with the matching data
   */
  export function getRelationMatchingSelector(selector: GenericSelector):
    (Element | null)[][] {
    if (!selector.selector_version || selector.selector_version === 1) {
      let rowNodeLists = getRowsMatchingSelector(selector);
      // now that we have some row nodes, time to extract the individual cells
      let cells = getCellsMatchingSelector(selector, rowNodeLists);
      window.WALconsole.log("cells", cells);
      //cells = onlyDisplayedCellsAndRows(cells);
      window.WALconsole.log("returning cells 1", cells);
      return cells;      
    } else if (selector.selector_version === 2) {
      // TODO: cjbaik: cannot tell if this is ever used...
      // todo: ugh, gross that we descend here butnot in the above
      let optionNodes = interpretPulldownSelector(
        <PulldownFeatureSet> selector.selector);
      console.log("selector.exclude_first", selector.exclude_first);
      optionNodes = optionNodes.splice(selector.exclude_first,
        optionNodes.length);
      return optionNodes.map((o: Element[]) => [o]);
      // cells = onlyDisplayedCellsAndRows(cells);
      // window.WALconsole.log("returning cells 2", cells);
    } else {
      console.log("about to throw new unknown selector type version error",
        selector);
      throw new Error("Unknown selectorTypeVersion");
    }
  }


/**********************************************************************
 * How to actually synthesize the selectors used by the relation-finder above
 **********************************************************************/
  /**
   * Gets {@link ColumnSelector}s of descendant nodes given the ancestor node.
   * @param ancestor ancestor node
   * @param descendants descendant nodes
   */
  function getColumnSelectors(ancestor: Element,
    descendants: (Element | null)[]) {
    let columns: ColumnSelector[] = [];
    for (const descendant of descendants) {
      if (!descendant) {
        throw new ReferenceError('TODO: This descendant is null. Handle it?');
      }
      let xpath = nodeToXPath(descendant);
      let suffix = XPath.suffixFromAncestor(ancestor, descendant);
      columns.push({
        xpath: xpath,
        suffix: suffix,
        id: null}
      );
    }
    return columns;
  }

  /**
   * Create a selector given relevant parameters
   * @param selector
   * @param exclude_first 
   * @param columns 
   * @param positive_nodes 
   * @param negative_nodes 
   */
  function createSelector(
    selector: GenericFeatureSet,
    exclude_first: number,
    columns: ColumnSelector[],
    positive_nodes?: Element[],
    negative_nodes?: Element[]): GenericSelector {
    // this form of Selector object should only be used for version 1 selectors,
    //   or else change this
    return {
      selector: selector, 
      exclude_first: exclude_first, 
      columns: columns, 
      positive_nodes: positive_nodes, 
      negative_nodes: negative_nodes,
      selector_version: 1
    }; 
  }

  function synthesizeSelector(positiveNodes: Element[],
    negativeNodes: Element[], columns: ColumnSelector[],
    features = ["tag", "xpath"]): GenericSelector {
    let featureSet = Features.getFeatureSet(features, positiveNodes);

    // If we can't shrink things down to less than 3 common XPaths, then exclude
    //   XPath and use the other features.
    if (featureSet["xpath"]?.values.length > 3 &&
        features !== Features.FEATURES_EXCEPT_XPATH) {
      return synthesizeSelector(positiveNodes, negativeNodes, columns,
        Features.FEATURES_EXCEPT_XPATH);
    }

    let rows = getRelationMatchingSelector(
      createSelector(featureSet, 0, columns)
    );
    
    //now handle negative examples
    let exclude_first = 0;
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++){
      let nodes = rows[rowIndex];
      for (const node of nodes) {
        if (node && negativeNodes.includes(node)) {
          if (rowIndex === 0) {
            exclude_first = 1;
          } else if (features !== Features.FEATURES_EXCEPT_XPATH) {
            // xpaths weren't enough to exclude nodes we need to exclude
            window.WALconsole.log("need to try more features.");
            return synthesizeSelector(positiveNodes, negativeNodes, columns,
              Features.FEATURES_EXCEPT_XPATH);
          }
          else {
            window.WALconsole.log(featureSet);
            throw new Error("Failed to exclude all negative nodes " + 
              "even with all features.");
          }
        }
      }
    }
    return createSelector(featureSet, exclude_first, columns, positiveNodes,
      negativeNodes);
  }

  /**
   * TODO: cjbaik: what is this for?
   * @param curSelector original selector
   */
  function synthesizeEditedSelectorFromOldSelector(curSelector: ContentSelector) {
    if (!curSelector.positive_nodes) {
      throw new ReferenceError('Selector does not contain any positive nodes.');
    }
    if (!curSelector.negative_nodes) {
      throw new ReferenceError('Selector does not contain any negative nodes.');
    }
    let newSelector = synthesizeSelector(curSelector.positive_nodes,
      curSelector.negative_nodes, curSelector.columns);
    
    // keep features of old selector that don't relate to actual row selector
    newSelector.next_type = curSelector.next_type;
    newSelector.next_button_selector = curSelector.next_button_selector;
    newSelector.name = curSelector.name;
    newSelector.id = curSelector.id;
    newSelector.url = curSelector.url;

    return newSelector;
  }

  /**
   * Create {@link Selector} given a list of column nodes comprising a row.
   * @param cells list of cell elements in the row
   */
  export function createSelectorFromSingleRow(cells: Element[]) {
    let ancestor = XPath.findCommonAncestor(cells);
    let positiveNodes = [ancestor];
    let columns = getColumnSelectors(ancestor, cells);
    let suffixes = columns.map((col) => col.suffix);
    let matchingDescendantSibling = 
      XPath.findDescendantSiblingMatchingSuffixes(ancestor, suffixes);
    if (matchingDescendantSibling !== null){
      positiveNodes.push(matchingDescendantSibling);
    }
    let selector = synthesizeSelector(positiveNodes, [], columns);
    let relation = getRelationMatchingSelector(selector);
    selector.relation = relation;

    for (let i = 0; i < relation.length; i++){
      let relRow = relation[i];
      // Find the first relation row that contains the first column node to find
      //   how many header rows there are
      if (relRow.some((cell: Element) => cells[0] === cell)) {
        selector.exclude_first = i;
        break;
      }
    }
    return <ContentSelector> selector;
  }

  /**
   * Produce the powerset of the array.
   * @param arr the array
   * @param descSize true if descending size
   */
  function powerset(arr: any[], descSize = false) {
      let ps = [[]];
      for (let i = 0; i < arr.length; i++) {
        let prevLength = ps.length;
        for (let j = 0; j < prevLength; j++) {
            ps.push(ps[j].concat(arr[i]));
        }
      }
      // ok, ps has them in order from smallest to largest.  let's reverse that
      if (descSize) {
        return ps.reverse();
      } else {
        return ps;
      }
  }

  /**
   * Create {@link Selector} from a subset of cell elements comprising a row
   *   such that the largest subsets are considered first, with the number of
   *   rows found in the relation acting as a tiebreaker.
   * @param cells list of cell elements in the row
   * @param minSubsetSize minimum number of cell elements to consider
   */
  function createSelectorFromLargestRowSubset(cells: Element[],
    minSubsetSize: number) {
    // TODO: cjbaik: in future, can we just order the combos by number of
    //   rowNodes included in the combo, stop once we get one that has a good
    //   selector? could this avoid wasting so much time on this? even in cases
    //   where we don't already have server-suggested to help us with
    //   smallestSubsetToConsider?
    let combos = powerset(cells, true);
    window.WALconsole.log("combos", combos);
    let maxNumCells = -1;
    let maxSelector: ContentSelector | null = null;
    let maxComboSize = -1;
    for (const combo of combos) {
      window.WALconsole.log("working on a new combo", combo);
      // TODO: cjbaik: the if below is an inefficient way to do this!
      //   do it better in future!  just make the smaller set of combos!
      if (combo.length < minSubsetSize){
        window.WALconsole.log("skipping a combo becuase it's smaller than the server-suggested combo", combo, minSubsetSize);
        continue;
      }
      if (combo.length < maxComboSize){
        // remember, we're going through combinations in order from the largest
        //   to smallest size so if we've already found one of a large size (a
        //   large number of matched xpaths), there's no need to spend time
        //   looking for smaller ones that we actually don't prefer
        continue;
      }
      if (combo.length == 0) { break; }

      let selector = createSelectorFromSingleRow(combo);
      window.WALconsole.log("selector", selector);
      if (selector.relation.length <= 1) {
        // we're really not interested in relations of size one -- it's not
        //   going to require parameterization at all
        window.WALconsole.log("ignoring a combo because it produces a length 1 relation", combo, selector.relation);
        continue;
      }

      let numCells = combo.length * selector.relation.length;
      if (numCells > maxNumCells) {
        maxNumCells = numCells;
        maxSelector = selector;
        maxComboSize = combo.length;
        window.WALconsole.log("maxselector so far", maxSelector);
        window.WALconsole.log("relation so far", selector.relation);
      }
    }

    if (!maxSelector){
      window.WALconsole.log("No maxSelector");
      return null;
    }
    window.WALconsole.log("returning maxselector", maxSelector);
    return maxSelector;
  }

  /**
   * Create a selector for cells residing in a <table> element.
   * @param cells elements describing cells in the row
   */
  function createSelectorFromSingleTableRow(cells: Element[]) {
    window.WALconsole.log(cells);

    let trs = [];

    // Get ancestor <tr> elements
    // TODO: cjbaik: currently only retrieving first one (i.e. does not consider
    //   nested tables)
    let closestTr = cells[0].closest("tr");
    if (closestTr && closestTr !== cells[0]) {
      trs.push(closestTr);
    }

    if (trs.length === 0){
      window.WALconsole.log("No tr parents.");
      return null;
    }
    
    // Keep only <tr> elements which contain all the column elements
    trs = trs.filter((tr) =>
      cells.every((el) => tr.contains(el))
    );

    if (trs.length === 0){
      window.WALconsole.log("No shared tr parents.");
      return null;
    }

    let bestScore = -1;
    let bestSelector: ContentSelector | null = null;
    for (const tr of trs) {
      let tableParent = tr.closest("table");

      if (!tableParent) {
        throw new ReferenceError("<tr> has no <table> parent!");
      }

      let siblingTrs = [].slice.call(tableParent.querySelectorAll("tr"));
      let index = siblingTrs.indexOf(tr);
      let tableFeatureSet = Features.createTableFeatureSet(tableParent);
      
      let tdThCells = [].slice.call(tr.querySelectorAll("td, th"));
      // union of td/th cells and originally provided cells
      let allCells = [...new Set([...tdThCells, ...cells])];
      let selector = createSelector(tableFeatureSet, index,
        getColumnSelectors(tr, allCells), cells, []);
      let relation = getRelationMatchingSelector(selector);
      selector.relation = relation;
      let score = relation.length * relation[0].length;
      if (score > bestScore){
        bestScore = score;
        bestSelector = <ContentSelector> selector;
      }
    }

    return bestSelector;
  }

  /**
   * Counts how many XPath expressions in xpaths intersects with the xpaths of
   *   the cells in the first row.
   * @param xpaths XPath expressions
   * @param firstRow cells in first row
   */
  function numMatchedXpaths(xpaths: string[], firstRow: MainpanelNodeRep[]) {
    let firstRowXpaths = firstRow.map((cell) => cell.xpath);
    return xpaths.filter((xpath) => firstRowXpaths.includes(xpath)).length;
  }

  /**
   * Returns the XPath expression in xpaths that do not intersect with any of
   *   the xpaths of the cells in the first row.
   * @param xpaths XPath expressions
   * @param firstRow cells in first row
   */
  function unmatchedXpaths(xpaths: string[], firstRow: MainpanelNodeRep[]) {
    let firstRowXpaths = firstRow.map((cell) => cell.xpath);
    return xpaths.filter((xpath) => !firstRowXpaths.includes(xpath));
  }

  /**
   * Converts selector to a comparison selector for finding the best selector.
   * @param selector selector
   * @param xpaths xpaths
   */
  function convertToComparisonSelector(selector: GenericSelector,
    xpaths: string[]): ComparisonSelector {
    let rel = <MainpanelNodeRep[][]> selector.relation;
    
    if (!rel) {
      throw new ReferenceError('Relation on selector undefined.')
    }

    return {
      ...selector,
      relation: rel,
      numMatchedXpaths: rel.length === 0? 0 : numMatchedXpaths(xpaths, rel[0]),
      numRows: rel.length,
      numRowsInDemo: rel.length,
      numColumns: rel.length === 0? 0 : rel[0].length
    };
  }

  /**
   * Converts a selector retrieved from the server to a comparison selector for
   *   finding the best selector.
   * @param selector selector
   * @param xpaths xpaths
   */
  function convertServerSelectorForComparison(selector: GenericSelector,
    xpaths: string[]): ComparisonSelector {
    let rel = <MainpanelNodeRep[][]> selector.relation;
    
    if (!rel) {
      throw new ReferenceError('Relation on selector undefined.');
    }

    if (!selector.num_rows_in_demonstration) {
      throw new ReferenceError('Selector missing `num_rows_in_demonstration`.');
    }

    return {
      ...selector,
      relation: rel,
      numMatchedXpaths: numMatchedXpaths(xpaths, rel[0]),
      numRows: rel.length,
      numRowsInDemo: selector.num_rows_in_demonstration,
      numColumns: rel[0].length
    };
  }

  /**
   * Selects the preferred selector among the two in order of:
   *   1. largest number of target xpaths in the first row,
   *   2. largest number of rows retrieved from the page,
   *   3. largest num of rows in original demonstration,
   *   4. largest number of columns associated with relation
   *   5. other miscellaneous criteria
   * @param first first selector
   * @param second second selector
   */
  function bestSelector(first: ComparisonSelector, second: ComparisonSelector) {
    // first things first, before we get into anything else, we always want a
    //   relation with more than one row or else we don't really care about it.
    //   so default or no, we're going to eliminate it if it only has one
    if (first.numRowsInDemo > 1 && second.numRowsInDemo <= 1) {
      return first;
    }
    else if (second.numRowsInDemo > 1 && first.numRowsInDemo <= 1) {
      return second;
    }

    // normal processesing - just go through the features we care about, and
    //   pick default if it wins on any of our ordered list of features, else
    //   the alternative. we only really get into crazy tie breakers if we're
    //   tied on num of matched xpaths, because whichever wins there can
    //   automatically win the whole thing but if they're tied, we go into the
    //   extra feature deciders
    if (first.numMatchedXpaths > second.numMatchedXpaths){
      return first;
    }
    else if (first.numMatchedXpaths === second.numMatchedXpaths){
      if (first.numRows > second.numRows){
        return first;
      }
      else if (first.numRows === second.numRows){
        if (first.numRowsInDemo > second.numRowsInDemo){
          return first;
        }
        else if (first.numRowsInDemo === second.numRowsInDemo){
          if (first.numColumns > second.numColumns){
            return first;
          }
          else if (first.numColumns === second.numColumns){
            if (first.next_type !== null && second.next_type === null){
              // first has a next button method, but second
              //   doesn't, so first better
              return first;
            }
            else if (!(second.next_type !== null && first.next_type === null)){
              // it's not the case that second has next method and first
              //   doesn't, so either both have it or neither has it, so
              //   they're the same, so just return the default one
              return first;
            }
          }
        }
      }
    }
    return second;
  }

  function xpathsToElements(xpaths: string[]) {
    if (!xpaths || xpaths.length === 0){
      window.WALconsole.warn("Woah woah woah, why are there no xpaths.  This is probably very bad.");
      return [];
    }
    let elements = [];
    for (let i = 0; i < xpaths.length; i++){
      let element = <Element> xPathToNodes(xpaths[i])[0];
      if (!element) {
        // todo: this may not be the right thing to do!
        // for now we're assuming that if we can't find a node at this xpath,
        //   it's because we jumbled in the nodes from a different page into the
        //   relation for this page (becuase no updat to url or something); but
        //   it may just mean that this page changed super super quickly, since
        //   the recording
        continue;
      }
      elements.push(element);
    }
    return elements;
  }

  /**
   * Adds necessary information for {@link SuffixXPathNode} to a list of
   *   {@link ColumnSelector}s.
   * @param colSelectors column selectors 
   * @param selectorIndex selector index for suffix
   */
  function labelColumnSuffixesWithTheirSelectors(colSelectors: ColumnSelector[],
    selectorIndex: number) {
  
    for (const col of colSelectors) {
      let curSuffixes = col.suffix;
      if (window.MiscUtilities.depthOf(curSuffixes) < 3) {
        // when we have only one suffix node, we don't store it in a list, but
        //   the below is cleaner if we just have a list; todo: clean up
        curSuffixes = [ <SuffixXPathList> curSuffixes ];
      }
      let outputSuffixLs = [];
      for (const suffix of curSuffixes) {
        if (suffix.selectorIndex) {
          // it's already an object with a selector index, and we just need to
          //   update the selectorIndex
          suffix.selectorIndex = selectorIndex;
          outputSuffixLs.push(suffix);
        } else {
          // ah, still just the old list representation of a selector.  need to
          //   make it into a selectorIndex-labeled object
          outputSuffixLs.push({
            selectorIndex: selectorIndex,
            suffixRepresentation: suffix
          });
        }
      }
      col.suffix = outputSuffixLs;
    }
  }

  /**
   * Modifies origSelector by merging selectorToAdd into it.
   * @param origSelector original selector
   * @param selectorToAdd selector to add
   */
  function mergeSelectors(origSelector: GenericSelector,
    selectorToAdd: GenericSelector) {
    if (Array.isArray(selectorToAdd)) {
      throw new ReferenceError("This function only permits a singular value" +
        " for `selectorToAdd.selector`");
    }
    let featureSetToAdd = <GenericFeatureSet> selectorToAdd.selector;

    let origFeatureSet = origSelector.selector;
    if (!origFeatureSet) { 
      // can happen that we have no selector to augment, if we're actually
      //   demo-ing a new relation
      origFeatureSet = [];
      origSelector.columns = [];
    }
    
    if (Array.isArray(origFeatureSet)) {
      // cool, no need to mess around with the current selector's columns
      // let's just add the new selector to the list
      origSelector.selector = origFeatureSet.concat([ featureSetToAdd ]);
    } else {
      // ok, this selector used to have just one.  let's go ahead and turn it
      //   into a list and make sure all its column objects have all their
      //   suffixes labeled with index 0, since the current selector will be
      //   the first in the list
      origSelector.selector = [origFeatureSet, featureSetToAdd];
      labelColumnSuffixesWithTheirSelectors(origSelector.columns, 0);
    }
    // and in either case, we need to add the new selectors columns to the prior
    //   set of columns, and we need to label them with the position in the list
    //   of selectors (len minus one)
    labelColumnSuffixesWithTheirSelectors(selectorToAdd.columns,
      (<GenericFeatureSet[]> origSelector.selector).length - 1);
    origSelector.columns = origSelector.columns.concat(selectorToAdd.columns);
    return origSelector;
  }

  /**
   * Extract relation of child option elements given a select element.
   * @param selectEl select element
   */
  function extractOptionsRelationFromSelectElement(selectEl: Element){
    let optionEls = [].slice.call(selectEl.querySelectorAll("option"));
    let optionsRelation = optionEls.map((el: Element) =>
      [ NodeRep.nodeToMainpanelNodeRepresentation(el) ]);
    console.log("optionsRelation in extractOptionsRelationFromSelectorNode",
      optionsRelation, optionsRelation.length);
    return optionsRelation;
  }

  /**
   * Create relations for XPaths of <select> (i.e. pulldown) elements.
   * @param msg message content from mainpanel
   * @param pulldownXPaths xpaths containing pulldowns
   */
  function makeRelationsForPulldownXpaths(msg: LikelyRelationMessageContent,
    pulldownXPaths: string[]) {
    let pulldownRelations = [];
    let selectNodes = [].slice.call(document.querySelectorAll("select"));
    for (const pulldownXPath of pulldownXPaths) {
      // pageVarName is used by the mainpanel to keep track of which pages have
      //   been handled already
      let featureSet: PulldownFeatureSet = {
        type: "pulldown",
        index: -1
      };
      let selector: GenericSelector = {
        selector_version: 2,  // 2 is for pulldown selectors
        selector: featureSet,
        page_var_name: msg.pageVarName,
        url: window.location.href,
        columns: [],

        // convenient to always use 0 so we can correctly index into the
        //   relation
        exclude_first: 0,   // TODO: can we do better?
      };
      let node = xPathToNodes(pulldownXPath)[0];
      if (!node) {
        continue; // TODO: right thing to do?
      }
      let index = selectNodes.indexOf(node);
      let optionsRelation = extractOptionsRelationFromSelectElement(
        <Element> node);
      let firstRowXpath = optionsRelation[0][0].xpath;
      
      // TODO: cjbaik: this is a no-op so long as excludeFirst is always 0
      // optionsRelation = optionsRelation.splice(selector.exclude_first,
      // optionsRelation.length);

      selector.relation_id = null;
      selector.name = "pulldown_" + (index + 1);
      // for a pulldown menu, there better be no more items
      selector.next_type = window.NextTypes.NONE;
      selector.next_button_selector = null;
      selector.num_rows_in_demonstration = optionsRelation.length;
      featureSet.index = index;
      selector.columns.push({
        id: null,
        index: 0, // only one column
        name: selector.name + "_option",
        suffix: [],
        xpath: firstRowXpath
      });
      selector.first_page_relation = optionsRelation;  

      pulldownRelations.push(selector);
    }
    return pulldownRelations;
  }

  let processedCount = 0;
  let processedLikelyRelationRequest = false;
  export function likelyRelation(msg: LikelyRelationMessageContent) {
    if (processedLikelyRelationRequest) {
      // should only even send a likely relation once from one page, since it
      //   gets closed after we get the answer we wanted may end up sending
      //   multiples if we're sent the inciting message multiple times because
      //   the page loads slowly
      return;
    }

    let xpaths = msg.xpaths;

    // we're going to do something a little different for the case where one or
    //   more nodes come from pulldown menus
    let pulldownxpaths: string[] = [];
    if (xpaths) {
      for (const xpath of xpaths) {
        if (xpath.toLowerCase().includes("/select[")) {
          // ok, we've grabbed something from a pulldown
          pulldownxpaths.push(xpath);
        }
      }      
    }

    // for pulldown xpaths, we'll do something different
    let pulldownRelations = makeRelationsForPulldownXpaths(msg, pulldownxpaths);

    // for the non-pulldown xpaths, we'll proceed with normal processing
    let nonPulldownXPaths = xpaths.filter((xpath) =>
      !pulldownxpaths.includes(xpath));

    let elements = xpathsToElements(nonPulldownXPaths);

    let maxNodesCoveredByServerRelations = 0;
    let serverSuggestedRelations = msg.serverSuggestedRelations;
    if (serverSuggestedRelations){
      for (const rel of serverSuggestedRelations) {
        if (!rel) {
          continue;
        }
        let columns = rel.columns;
        let relXpaths = columns.map((col) => col.xpath);
        window.WALconsole.log(relXpaths);

        let matched = 0;
        for (const xpath of nonPulldownXPaths) {
          if (relXpaths.includes(xpath)){
            matched += 1;
          }
        }

        if (matched > maxNodesCoveredByServerRelations){
          maxNodesCoveredByServerRelations = matched;
        }
      }
      window.WALconsole.log("maxNodesCoveredByServerRelations",
        maxNodesCoveredByServerRelations);
    }

    // if this is actually in an html table, let's take a shortcut, since some
    //   sites use massive tables and trying to run the other approach would
    //   take forever
    let genericSelector = createSelectorFromSingleTableRow(elements);

    if (genericSelector === null) {
      // ok, no table, we have to do the standard, possibly slow approach
      genericSelector = createSelectorFromLargestRowSubset(elements,
        maxNodesCoveredByServerRelations + 1);
    }
    if (genericSelector === null) {
      genericSelector = {
        selector_version: 1,
        selector: {},
        exclude_first: 0,
        columns: [],
        relation: []
      };
      console.warn("Generated empty selector, not sure what it means.");
    }

    let selectorData = {
      ...genericSelector,
      relation: relationNodesToMainpanelNodeRepresentation(
        genericSelector.relation)
    };
    window.WALconsole.log("synthesized a selector, selectorData", selectorData);

    // this (above) is the candidate we auto-generate from the page, but want to
    //   compare to the relations the server-suggested criteria.
    let bestSelectorIsNew = true;
    let curBestSelector = convertToComparisonSelector(selectorData, xpaths);

    if (serverSuggestedRelations) {
      for (const serverRel of serverSuggestedRelations) {
        if (serverRel === null) {
          continue;
        }
        let serverSelector = createSelector(serverRel.selector,
          serverRel.exclude_first, serverRel.columns);
        serverSelector.selector_version = serverRel.selector_version;
        let relationNodes = getRelationMatchingSelector(serverSelector);
        if (relationNodes.length === 0){
          // no need to consider empty one
          continue;
        }
        
        serverRel.relation = relationNodesToMainpanelNodeRepresentation(
          relationNodes);
        let compServerRel = convertServerSelectorForComparison(serverRel,
          xpaths);

        window.WALconsole.log("default", serverRel, "new", curBestSelector);
        // use the server-provided rel as our default, since that'll make the
        //   server-side processing when we save the relation easier, and also
        //   gives us the nice names
        let newBestSelector = bestSelector(compServerRel, curBestSelector);
        if (newBestSelector !== curBestSelector){
          curBestSelector = newBestSelector;
          bestSelectorIsNew = false;
        }
      }
    }

    // ok, we've picked our best selector.  of course, it's possible it doesn't
    //   cover all columns if it doesn't cover all columns, we're willing to add
    //   up to one more supplementary selector
    // todo: in future, consider adding more than one additional selector --
    //   may need up to one selector per column but for now, we'll try one
    let uncoveredSoFar = unmatchedXpaths(xpaths, curBestSelector.relation[0]);
    window.WALconsole.log("uncoveredSoFar", uncoveredSoFar);
    if (uncoveredSoFar.length > 0) {
      // let's see if we can cover as many as possible of the remaining nodes
      let uncoveredNodes = xpathsToElements(uncoveredSoFar);
      let newSelector = createSelectorFromLargestRowSubset(
        uncoveredNodes, 0);
      
      // now reason about the length of the lists and whether it even makes
      //   sense to pair them
      if (newSelector &&
        curBestSelector.relation?.length === newSelector.relation?.length){
        window.WALconsole.log("We're adding an additional selector.", newSelector);
        curBestSelector = <ComparisonSelector> mergeSelectors(curBestSelector,
          newSelector);
        let rel = getRelationMatchingSelector(curBestSelector);
        curBestSelector.relation = relationNodesToMainpanelNodeRepresentation(rel);
        window.WALconsole.log("currBestSelector.relation", curBestSelector.relation);
      }
    }

    // this pageVarName is used by the mainpanel to keep track of which pages
    //   have been handled already
    let resultSelector: GenericSelector = {
      selector_version: 1,
      selector: curBestSelector.selector,
      columns: curBestSelector.columns,
      exclude_first: curBestSelector.exclude_first,
      first_page_relation: curBestSelector.relation,
      num_rows_in_demonstration: curBestSelector.relation.length,
      page_var_name: msg.pageVarName,
      url: window.location.href
    };

    if (bestSelectorIsNew) {
      resultSelector.relation_id = null;
      resultSelector.name = null;
      // we always guess that there are no more items (no more pages), and user
      //   has to correct it if this is not the case
      resultSelector.next_type = window.NextTypes.NONE;
      resultSelector.next_button_selector = null;
    } else {
      resultSelector.relation_id = curBestSelector.id;
      resultSelector.name = curBestSelector.name;
      resultSelector.next_type = curBestSelector.next_type;
      resultSelector.next_button_selector =
        curBestSelector.next_button_selector;
    }
    window.WALconsole.log("currBestSelector", curBestSelector);

    if (pulldownRelations.length > 0){
      resultSelector.pulldown_relations = pulldownRelations;
    }

    if (curBestSelector.relation.length < 1 && pulldownRelations.length < 1) {
      processedCount += 1;
      if (processedCount < 10) {
        // ok, looks like we don't actually have any data yet.  might be because
        // data hasn't fully loaded on page yet the mainpanel will keep asking
        // for likelyrelations, so let's wait a while, see if the next time
        // works; try 10 times
        // todo: not sure this is where we want to deal with this?
        return null;
      }
    }

    //window.utilities.sendMessage("content", "mainpanel", "likelyRelation", newMsg);
    processedLikelyRelationRequest = true;
    return resultSelector; // return rather than sendmessage because it's a builtin response handler one
  }

  /**
   * Send relation matching selector to mainpanel.
   * @param selector selector
   */
  export function sendRelationToMainpanel(selector: GenericSelector) {
    if (!selector.selector_version){
      console.error("No selector version!!!");
    }
    let relation = getRelationMatchingSelector(selector);
    let relationData = relationNodesToMainpanelNodeRepresentation(relation);
    window.utilities.sendMessage("content", "mainpanel", "relationItems", 
      { relation: relationData });
    return relationData;
  }

  /**
   * TODO: cjbaik: change to Relation.toMainpanelNodeRep or something like that
   * @param relation relation
   */
  export function relationNodesToMainpanelNodeRepresentation(
    relation: (Element | null)[][]) {
    return relation.map((row) =>
      row.map((cell) => NodeRep.nodeToMainpanelNodeRepresentation(cell))
    );
  }

  /**
   * Produces a stringified version of necessary keys on the selector.
   * TODO: cjbaik: convert to Selector.hash
   * @param selector selector
   */
  function selectorId(selector: GenericSelector) {
    // Only keep necessary keys with ES6 destructuring
    let cleanedSelector = (({ name, selector, columns, selector_version,
        exclude_first, next_type, next_button_selector, url,
        num_rows_in_demonstration }) =>
        ({ name, selector, columns, selector_version, exclude_first, next_type,
          next_button_selector, url, num_rows_in_demonstration }))(selector);
    return stringify(cleanedSelector);
  }
  

/**********************************************************************
 * Everything we need for editing a relation selector
 **********************************************************************/

  let currentSelectorToEdit: ContentSelector | null = null;
  let currentSelectorEmptyOnThisPage = false;
  export function editRelation(selector: GenericSelector){
    if (currentSelectorToEdit !== null) {
      // we've already set up to edit a selector, and we should never use the
      //   same tab to edit multiples always close tab and reload.  so don't run
      //   setup again
      return;
    }
    // window.utilities.sendMessage("mainpanel", "content", "editRelation", {selector: this.selector, selector_version: this.selectorVersion, exclude_first: this.excludeFirst, columns: this.columns}, null, null, [tab.id]);};
    currentSelectorToEdit = <ContentSelector> selector;

    // TODO: cjbaik: move this to some place for all document listeners
    document.addEventListener('click', editingClick, true);

    // don't try to process the page till it's loaded!  jquery onloaded stuff
    //   will run immediately if page already loaded, once loaded else
    let editingSetup = function() {
      if (!currentSelectorToEdit) {
        throw new ReferenceError('Current selector to edit is null!');
      }

      let contentSelector = convertToContentSelector(currentSelectorToEdit);
      if (contentSelector.relation.length < 1) {
        // ugh, but maybe the page just hasn't really finished loading, so try again in a sec
        // setTimeout(editingSetup, 1000);
	      // but also need to send the editing colors just in case
	       sendEditedSelectorToMainpanel(contentSelector);
         currentSelectorEmptyOnThisPage = true;
        return;
      }
      highlightSelector(contentSelector);
      // start with the assumption that the first row should definitely be included
      selector.positive_nodes = [
        XPath.findCommonAncestor(contentSelector.relation[0]),
        XPath.findCommonAncestor(contentSelector.relation[1])
      ];
      selector.negative_nodes = [];
      sendEditedSelectorToMainpanel(contentSelector);
      if (selector.next_type === window.NextTypes.NEXTBUTTON ||
          selector.next_type === window.NextTypes.MOREBUTTON){
        highlightNextOrMoreButton(
          <NextButtonSelector> selector.next_button_selector);
      }

      // we want to highlight the currently hovered node
      // TODO: cjbaik: move this document event listener? esp if editRelation
      //   gets called multiple times...
      document.addEventListener('mouseenter', highlightHovered, true);

      // also, if we have a selector highlighted, and the user scrolls, we're
      //   going to need to update...
      // TODO: cjbaik: move this too
      let didScroll = false;
      document.addEventListener('scroll', (e) => didScroll = true );
      
      // cjbaik: formerly, I don't think the '*' was desired behavior?
      // $('*').scroll(function () {
      //   didScroll = true;
      // });

      setInterval(function () {
        if ( didScroll ) {
          didScroll = false;
          // Ok, we're ready to redo the relation highlighting with new page
          //   situation
          window.WALconsole.log("scroll updating");
          newSelectorGuess(contentSelector);
        }
        }, 250);
    };

    $(editingSetup);
  }

  export function setEditRelationIndex(index: number) {
    if (!currentSelectorToEdit) {
      throw new ReferenceError('No selector to edit!');
    }
    currentSelectorToEdit.editingClickColumnIndex = index;
  }

  let currentHoverHighlight: JQuery<HTMLElement> | null = null;
  function highlightHovered(event: Event) {
    let prevHoverHighlight = currentHoverHighlight;
    let color = "#9D00FF";
    if (listeningForNextButtonClick) {
      color = "#E04343";
    }
    if (prevHoverHighlight) {
      prevHoverHighlight.remove();
      prevHoverHighlight = null;
    }
    currentHoverHighlight = window.Highlight.highlightNode(event.target, color);
  }

  /**
   * Converts a generic selector to a content selector by setting the relation.
   * @param selector selector
   */
  export function convertToContentSelector(selector: GenericSelector){
    selector.relation = getRelationMatchingSelector(selector);
    selector.num_rows_in_demonstration = selector.relation.length;
    return <ContentSelector> selector;
  }

  let currentSelectorHighlightNodes: JQuery<HTMLElement>[] = [];
  export function highlightSelector(selector: ContentSelector) {
    // we want to allow clicks on the highlights (see editingClick)
    currentSelectorHighlightNodes =
      window.helenaContent.relationHighlighter.highlightRelation(
        selector.relation, true, true);
  };

  export function highlightCurrentSelector() {
    if (!currentSelectorToEdit) {
      throw new ReferenceError('No selector to highlight!');
    }
    highlightSelector(currentSelectorToEdit);
  }

  /**
   * Send edited selector to the mainpanel.
   * @param selector selector
   */
  export function sendEditedSelectorToMainpanel(selector: ContentSelector) {
    let mainpanelSelector = {
      ...selector,
      demonstration_time_relation: relationNodesToMainpanelNodeRepresentation(
        selector.relation),
      relation: null,     // don't send the relation

      // TODO: cjbaik: this seems like a bad idea
      colors: window.helenaContent.relationHighlighter.highlightColors
    };

    window.utilities.sendMessage("content", "mainpanel", "editRelation",
      mainpanelSelector);
  };

  export function clearCurrentSelectorHighlight(){
    for (var i = 0; i < currentSelectorHighlightNodes.length; i++) {
      window.Highlight.clearHighlight(currentSelectorHighlightNodes[i]);
    }
    currentSelectorHighlightNodes = [];
  };

  export function newSelectorGuess(selector: GenericSelector) {
    let contentSelector = convertToContentSelector(selector);
    clearCurrentSelectorHighlight();
    highlightSelector(contentSelector);
    sendEditedSelectorToMainpanel(contentSelector);
  }

  function findAncestorLikeSpec(specAncestor: Element, element: Element){
    //will return exactly the same node if there's only one item in first_row_items
    window.WALconsole.log("findAncestorLikeSpec", specAncestor, element);
    let spec_xpath_list = OldXPathList.xPathToXPathList(nodeToXPath(specAncestor));
    let xpath_list = OldXPathList.xPathToXPathList(nodeToXPath(element));
    let ancestor_xpath_list = xpath_list.slice(0,spec_xpath_list.length);
    let ancestor_xpath_string = OldXPathList.xPathToString(ancestor_xpath_list);
    let ancestor_xpath_nodes = xPathToNodes(ancestor_xpath_string);
    return <Element> ancestor_xpath_nodes[0];
  }

  let targetsSoFar: Element[] = [];
  function editingClick(event: MouseEvent) {
    if (!currentSelectorToEdit) {
      throw new ReferenceError('No selector to edit!');
    }

    if (listeningForNextButtonClick) {
      // don't want to do normal editing click...
      nextButtonSelectorClick(event);
      return;
    }

    event.stopPropagation();
    event.preventDefault();

    let target = <Element> event.target;

    if (currentSelectorEmptyOnThisPage) {
      // ok, it's empty right now, need to make a new one
      if (!currentSelectorToEdit.origSelector){
        // deepcopy
        currentSelectorToEdit.origSelector = JSON.parse(
          JSON.stringify(currentSelectorToEdit)
        ); 
      }
      targetsSoFar.push(target);

      let newSelector = createSelectorFromSingleRow(targetsSoFar);
      currentSelectorToEdit.currentIndividualSelector = newSelector; // just the individual selector that we want to play with
      let mergedSelector = mergeSelectors(
        <ContentSelector> currentSelectorToEdit.origSelector, newSelector);
      currentSelectorToEdit.selector = mergedSelector.selector;
      currentSelectorToEdit.columns = mergedSelector.columns;
      //currentSelectorToEdit = newSelector;
      newSelectorGuess(currentSelectorToEdit);
      // and let's go back to using .selector as the current one we want to edit and play with
      currentSelectorToEdit.selector =
        currentSelectorToEdit.currentIndividualSelector;
      currentSelectorToEdit.positive_nodes = [ target ];
      currentSelectorEmptyOnThisPage = false;
      return;
    }

    if (!currentSelectorToEdit.positive_nodes) {
      throw new ReferenceError('Selector contains no positive_nodes.');
    }

    let removalClick = false;
    // it's only a removal click if the clicked item is a highlight
    if (window.Highlight.isHighlight(target)) {
      removalClick = true;
      // actual target is the one associated with the highlight
      target = window.Highlight.getHighligthedNodeFromHighlightNode(target);
      // recall the target itself may be the positive example, as when there's
      //   only one column
      let nodeToRemove = target; 
      if (!currentSelectorToEdit.positive_nodes.includes(target)) {
        // ok it's not the actual node, better check the parents
        let parents = $(target).parents(); 
        for (let i = parents.length - 1; i > 0; i--){
          let parent = parents[i];
          let index = currentSelectorToEdit.positive_nodes.indexOf(parent);
          if (index > -1) {
            // ok, so this click is for removing a node.  removing the row?  removing the column?
            // not that useful to remove a column, so probably for removing a row...
            nodeToRemove = parent;
            break;
          }
        }
      }
      // actually remove the node from positive, add to negative
      let ind = currentSelectorToEdit.positive_nodes.indexOf(nodeToRemove);
      currentSelectorToEdit.positive_nodes.splice(ind, 1);
      if (!currentSelectorToEdit.negative_nodes){
        currentSelectorToEdit.negative_nodes = [];
      }
      currentSelectorToEdit.negative_nodes.push(nodeToRemove);
    }
    // we've done all our highlight stuff, know we no longer need that
    // dehighlight our old list
    currentSelectorHighlightNodes.forEach(window.Highlight.clearHighlight);

    if (!removalClick) {
      // ok, so we're trying to add a node.  is the node another cell in an
      //   existing row?  or another row?  could be either.
      // for now we're assuming it's always about adding rows, since it's
      //   already possible to add columns by demonstrating first row

      let newCellInExistingRow = false;
      if (newCellInExistingRow) {
        // for now, assume it's another cell in an existing row
        // todo: give the user an interaction that allows him or her say it's
        //   actually another row
        // todo: put some kind of outline around the ones we think of the user
        //   as having actually demonstrated to us?  the ones we're actually
        //   using to generate the selector?  so that he/she knows which to
        //   actually click on to change things
        // maybe green outlines (or color-corresponding outlines) around the
        //   ones we're trying to include, red outlines around the ones we're
        //   trying to exclude.

        // let's figure out which row it should be
        // go through all rows, find common ancestor of the cells in the row +
        //   our new item, pick whichever row produces an ancestor deepest in
        //   the tree
        let currRelation = currentSelectorToEdit.relation;
        let deepestCommonAncestor = null;
        let deepestCommonAncestorDepth = 0;
        let currRelationIndex = 0;
        for (let i = 0; i < currRelation.length; i++){
          let nodes = currRelation[i];
          let ancestor = XPath.findCommonAncestor(nodes.concat([target]));
          let depth = $(ancestor).parents().length;
          if (depth > deepestCommonAncestorDepth){
            deepestCommonAncestor = ancestor;
            deepestCommonAncestorDepth = depth;
            currRelationIndex = i;
          }
        }

        if (!deepestCommonAncestor) {
          throw new ReferenceError('No deepestCommonAncestor found.');
        }

        let columns = getColumnSelectors(deepestCommonAncestor,
          currRelation[currRelationIndex].concat([ target ]));
        currentSelectorToEdit.columns = columns;

        // let's check whether the common ancestor has actually changed.
        //   if no, this is easy and we can just change the columns
        //   if yes, it gets more complicated
        let origAncestor = XPath.findCommonAncestor(
          currRelation[currRelationIndex]);
        let newAncestor = XPath.findCommonAncestor(
          currRelation[currRelationIndex].concat([target]));
        if (origAncestor === newAncestor) {
          // we've already updated the columns, so we're ready
          newSelectorGuess(currentSelectorToEdit);
          return;
        }
        // drat, the ancestor has actually changed.
        // let's assume that all the items in our current positive nodes list
        //   will have *corresponding* parent nodes...  (based on difference in
        //   depth.  not really a good assumption, but we already assume that we
        //   have fixed xpaths to get to subcomponents, so we're already making
        //   that assumption)
        let xpath = nodeToXPath(newAncestor);
        let xpathlen = xpath.split("/").length;
        let xpathO = nodeToXPath(origAncestor);
        let xpathlenO = xpathO.split("/").length;
        let depthDiff = xpathlenO - xpathlen;
        for (let i = 0; i < currentSelectorToEdit.positive_nodes.length; i++) {
          let ixpath = nodeToXPath(currentSelectorToEdit.positive_nodes[i]);
          let components = ixpath.split("/");
          components = components.slice(0, components.length - depthDiff);
          let newxpath = components.join("/");
          currentSelectorToEdit.positive_nodes[i] =
            <Element> xPathToNodes(newxpath)[0];
        }
        if (!currentSelectorToEdit.positive_nodes.includes(
          deepestCommonAncestor)) {
          currentSelectorToEdit.positive_nodes.push(deepestCommonAncestor);
        }
      } else {
        // this one's the easy case!  the click is telling us to add a row,
        //   rather than to add a cell to an existing row or it may be telling
        //   us to add a cell in an existing row to an existing column, which
        //   also should not require us to change the ancestor node.  if it does
        //   require changing the ancestor node,then we will run into trouble
        //   bc won't find appropriate ancestor
        // TODO: better structure available here?  maybe merge this and the above?
        let appropriateAncestor = findAncestorLikeSpec(
          currentSelectorToEdit.positive_nodes[0], target);
        if (!currentSelectorToEdit.editingClickColumnIndex) {
          throw new ReferenceError('editingClickColumnIndex not set');
        }
        let currColumnObj = currentSelectorToEdit.columns[
          currentSelectorToEdit.editingClickColumnIndex];
        let currSuffixes: SuffixXPathList[];
        if (window.MiscUtilities.depthOf(currColumnObj.suffix) < 3){
          // when we have only one suffix, we don't store it in a list, but the
          //   below is cleaner if we just have a list; todo: clean up
          currSuffixes = [ <SuffixXPathList> currColumnObj.suffix ];
        } else {
          currSuffixes = <SuffixXPathList[]> currColumnObj.suffix;
        }

        // is this suffix already in our suffixes?  if yes, we can just add the
        //   ancestor/row node, don't need to mess with columns
        let newSuffix = XPath.suffixFromAncestor(appropriateAncestor, target);
        let newSuffixAlreadyPresent = currSuffixes.some(
          (suffix: SuffixXPathList) => {
            if (suffix.length !== newSuffix.length) { return false; }
            for (let i = 0; i < newSuffix.length; i++) {
              if (newSuffix[i].nodeName !== suffix[i].nodeName ||
                  newSuffix[i].iterable !== suffix[i].iterable ||
                  newSuffix[i].index !== suffix[i].index) {
                return false;
              }
            }
            return true;
          }
        );

        if (!newSuffixAlreadyPresent) {
          // ok it's not in our current suffixes, so we'll have to make the new
          //   suffixes list
          currSuffixes.push(newSuffix);     
          currColumnObj.suffix = currSuffixes;     
        }
    
        // is this ancestor node already in our positive_nodes?  if no, make new
        //   selector.  if yes, we're already set
        if (!currentSelectorToEdit.positive_nodes.includes(
          appropriateAncestor)) {
          // this ancestor node (row node) is new to us, better add it to the
          //   positive examples
          currentSelectorToEdit.positive_nodes.push(appropriateAncestor);
        }
      }

    }

    let newSelector = synthesizeEditedSelectorFromOldSelector(
      currentSelectorToEdit);
    newSelectorGuess(newSelector);
    currentSelectorToEdit = <ContentSelector> newSelector;
  }

/**********************************************************************
 * Handling next buttons
 **********************************************************************/

  let listeningForNextButtonClick = false;
  export function nextButtonSelector() {
    // ok, now we're listening for a next button click
    listeningForNextButtonClick = true;
    clearNextButtonSelector(); // remove an old one if there is one
    
    // in case the highlighting of cells blocks the next button, hide this
    clearCurrentSelectorHighlight(); 
  }

  export function clearNextButtonSelector() {
    // we just want to unhighlight it if there is one...
    unHighlightNextOrMoreButton();
  }

  function nextButtonSelectorClick(event: MouseEvent) {
    listeningForNextButtonClick = false;

    event.stopPropagation();
    event.preventDefault();

    if (!event.target) {
      throw new ReferenceError('Event has no target!');
    }
    
    let nextOrMoreButton = <Element> event.target;
    let data: NextButtonSelector = {
      tag: nextOrMoreButton.tagName,
      text: nextOrMoreButton.textContent,
      id: nextOrMoreButton.id,
      class: nextOrMoreButton.className,
      src: nextOrMoreButton.getAttribute('src'),
      xpath: nodeToXPath(nextOrMoreButton),
      frame_id: SimpleRecord.getFrameId()
    }
    
    window.utilities.sendMessage("content", "mainpanel", "nextButtonSelector",
      { selector: data }
    );
    highlightNextOrMoreButton(data);

    highlightCurrentSelector(); // rehighlight the relaiton items
  }

  /**
   * Determines whether a candidate element is a promising next button
   * @param nextSelector selector for the next button
   * @param candEl the candidate element to check
   * @param priorPageIndexText if traversing to pagination, the string of the
   *   last page index clicked
   */
  function isPromisingNextButton(nextSelector: NextButtonSelector,
    candEl: Element, priorPageIndexText?: string) {
    // either there's an actual image and it's the same, or the text is the same
    if (nextSelector.src) {
      return (candEl.getAttribute('src') === nextSelector.src);
    }
    if (!priorPageIndexText || isNaN(+priorPageIndexText)) {
      // we don't have a past next button or the past next button wasn't numeric
      //   so just look for the exact text
      return (candEl.textContent === nextSelector.text);
    } else {
      // it was a number!  so we're looking for the next number bigger than this
      //   one...
      // oh cool, there's been a prior next button, and it had a number text
      //   we'd better look for a button like it but that has a bigger number...
      // todo: make this more robust
      let prior = parseInt(priorPageIndexText);
      let currNodeText = candEl.textContent;
      if (!currNodeText) {
        throw new ReferenceError('Current element has no textContent.');
      }
      if (isNaN(+currNodeText)){
        return false;
      }
      let curr = parseInt(currNodeText);
      if (curr > prior){
        return true;
      }
    }
    return false;
  }

  function findNextButton(nextSelector: NextButtonSelector,
    priorPageIndexText?: string): HTMLElement | null {
    window.WALconsole.log(nextSelector);

    let next_or_more_button_text = nextSelector.text;
    let button = null;
    let candButtons = [].slice.call(
      document.querySelectorAll(nextSelector.tag)
    );
    candButtons = candButtons.filter((button: Element) =>
      isPromisingNextButton(nextSelector, button, priorPageIndexText)
    );
    window.WALconsole.namedLog("findNextButton", "candidate_buttons",
      candButtons);

    let doNumberVersion = priorPageIndexText && !isNaN(+priorPageIndexText);

    // hope there's only one button
    if (candButtons.length === 1 && !doNumberVersion) {
      window.WALconsole.namedLog("findNextButton", "only one button");
      return candButtons[0];
    }
    
    // if not and demo button had id, try using the id
    if (nextSelector.id && nextSelector.id !== "" && !doNumberVersion) {
      window.WALconsole.namedLog("findNextButton", "we had an id")
      let idElement = document.getElementById(nextSelector.id);
      if (idElement) {
        return idElement;
      }
    }

    // if not and demo button had class, try using the class
    let cbuttons = candButtons.filter((cand: Element) => 
      cand.className === nextSelector.class);
    if (cbuttons.length === 1 && !doNumberVersion) {
      window.WALconsole.namedLog("findNextButton",
        "filtered by class and there was only one");
      return cbuttons[0];
    }
    // ok, another case where we probably want to decide based on sharing class
    // is the case where we have numeric next buttons
    let lowestNodeSoFar = null
    if (priorPageIndexText && !isNaN(+priorPageIndexText)) {
      window.WALconsole.namedLog("findNextButton",
        "filtered by class and now trying to do numeric");
      
      // let's go through and just figure out which one has the next highest number relative to the prior next button text
      let lsToSearch = cbuttons;
      if (cbuttons.length < 1) {
        lsToSearch = candButtons;
      }
      let priorButtonNum = parseInt(priorPageIndexText);
      let lowestNumSoFar = Number.MAX_VALUE;
      window.WALconsole.namedLog("findNextButton", "potential buttons",
        lsToSearch);
      for (const button of lsToSearch) {
        let buttonText = button.textContent;
        console.log("button", button, buttonText);
        var buttonNum = parseInt(buttonText);
        console.log("comparison", buttonNum, lowestNumSoFar, priorButtonNum,
          buttonNum < lowestNumSoFar, buttonNum > priorButtonNum);
        if (buttonNum < lowestNumSoFar && buttonNum > priorButtonNum){
          lowestNumSoFar = buttonNum;
          lowestNodeSoFar = button;
        }
      }
    }

    if (lowestNodeSoFar) {
      window.WALconsole.namedLog("findNextButton", "numeric worked");
      return lowestNodeSoFar;
    } else {
      //see which candidate has the right text and closest xpath
      let min_distance = 999999;
      let min_candidate = null;
      for (const candButton of candButtons) {
        let candXPath = nodeToXPath(candButton);
        let distance = window.MiscUtilities.levenshteinDistance(candXPath,
          nextSelector.xpath);
        if (distance < min_distance){
          min_distance = distance;
          min_candidate = candButton;
        }
      }
      if (min_candidate === null) {
        window.WALconsole.log("couldn't find an appropriate 'more' button");
        window.WALconsole.log(nextSelector.tag, nextSelector.id,
          next_or_more_button_text, nextSelector.xpath);
      }
      return min_candidate;
    }
  }

  let nextOrMoreButtonHighlight: JQuery<HTMLElement> | null = null;
  function highlightNextOrMoreButton(selector: NextButtonSelector){
    window.WALconsole.log(selector);
    var button = findNextButton(selector);
    nextOrMoreButtonHighlight = window.Highlight.highlightNode(button,
      "#E04343", true);
  }

  function unHighlightNextOrMoreButton(){
    if (nextOrMoreButtonHighlight !== null) {
      window.Highlight.clearHighlight(nextOrMoreButtonHighlight);
    }
  }

/**********************************************************************
 * Handling everything we need for actually running the next interactions during replays
 **********************************************************************/

  let currentRelationData: {
    [key: string]: any;     // TODO: cjbaik: not sure what value types are
  } = {};
  // this will be adjusted when we're in the midst of running next button
  //   interactions
  let nextInteractionSinceLastGetFreshRelationItems: {
    [key: string]: boolean;
  } = {};
  let currentRelationSeenNodes: {
    [key: string]: number[]
  } = {};
  let noMoreItemsAvailable: {
    [key: string]: boolean;
  } = {};

  function scrollThroughRows(relation: MainpanelNodeRep[][]) {
    //console.log("scrolling through the rows based on crd", crd);
    let knowTheLastElement = false;
    for (let i = 0; i < relation.length; i++){
      let row = relation[i];
      for (let j = 0; j < row.length; j++){
        let elem = row[j];
        let elemNodes = <Element[]> xPathToNodes(elem.xpath);
        if (elemNodes.length > 0){
          let elemNode = elemNodes[0];
          elemNode.scrollIntoView(true);
          knowTheLastElement = true;
        }
      }
    }
    return knowTheLastElement;
  }

  function scrollThroughRowsOrSpace(relation: MainpanelNodeRep[][]) {
    // let's try scrolling to last element if we know it
    // sometimes it's important to scroll through the range of data, not go
    //   directly to the end, so we'll try scrolling to each in turn
    let knowTheLastElement = null;
    if (relation) {
      knowTheLastElement = scrollThroughRows(relation);
    }
    // but if we don't know it, just try scrolling window to the bottom
    //   sadly, this doesn't work for everything.  (for instance, if have an
    //   overlay with a relation, the overlay may not get scrolled w window
    //   scroll)
    if (!knowTheLastElement) {
      // go past 1 because sometimes the page is still working on loading
      //   content, getting longer
      for (let i = 0; i < 1.1; i+= 0.01) { 
        window.scrollTo(0, document.body.scrollHeight * i);
      }
    }
  }

  export function clearRelationInfo(selector: GenericSelector) {
    window.WALconsole.namedLog("nextInteraction", "clearing relation info",
      selector);
    var sid = selectorId(selector);
    delete nextInteractionSinceLastGetFreshRelationItems[sid];
    delete currentRelationData[sid];
    delete currentRelationSeenNodes[sid];
    delete noMoreItemsAvailable[sid];
    window.utilities.sendMessage("content", "mainpanel", "clearedRelationInfo",
      {});
  }

  // below the methods for actually using the next button when we need the next
  //   page of results. this also identifies if there are no more items to
  //   retrieve, in which case that info is stored in case someone tries to run
  //   getFreshRelationItems on us
  export function runNextInteraction(selector: GenericSelector) {
    window.WALconsole.namedLog("nextInteraction", "running next interaction",
      selector);

    // todo: will this always reach the page?  if not, big trouble
    window.utilities.sendMessage("content", "mainpanel",
      "runningNextInteraction", {});

    let sid = selectorId(selector);
    if (sid in currentRelationData) {
      window.WALconsole.namedLog("nextInteraction",
        "sid in currentRelationData");
    } else {
      window.WALconsole.namedLog("nextInteraction",
        "sid not in currentRelationData");
      window.WALconsole.namedLog("nextInteraction", currentRelationData);
      window.WALconsole.namedLog("nextInteraction", "----");
      window.WALconsole.namedLog("nextInteraction", sid);
      for (const key in currentRelationData){
        console.log(key === sid);
        console.log(key.slice(20));
        console.log(sid.slice(20));
      }
    }

    // note that we're assuming that the next interaction for a given relation
    //   only affects that relation
    nextInteractionSinceLastGetFreshRelationItems[sid] = true; 

    let nextButtonType = selector.next_type;

    if (nextButtonType === window.NextTypes.SCROLLFORMORE) {
      window.WALconsole.namedLog("nextInteraction", "scrolling for more");
      let crd = currentRelationData[sid];
      scrollThroughRowsOrSpace(crd);
    } else if (nextButtonType === window.NextTypes.MOREBUTTON ||
      nextButtonType === window.NextTypes.NEXTBUTTON) {
      window.WALconsole.namedLog("nextInteraction", "msg.next_button_selector",
        selector.next_button_selector);

      let crd = currentRelationData[sid];
      if (nextButtonType === window.NextTypes.MOREBUTTON) {
        // for user understanding what's happening, it's convenient if we're using the more button for us to actually scroll through the elements
        // this isn't critical, but probably can't hurt
        scrollThroughRowsOrSpace(crd);
      }

      let button = findNextButton(
        <NextButtonSelector> selector.next_button_selector,
        selector.prior_next_button_text);
      if (button) {
        window.utilities.sendMessage("content", "mainpanel", "nextButtonText",
          { text: button.textContent });
        window.WALconsole.namedLog("nextInteraction",
          "clicked next or more button");
        console.log("About to click on node", button, button.textContent);
        button.click();
      } else {
        window.WALconsole.namedLog("nextInteraction",
          "next or more button was null");
        noMoreItemsAvailable[sid] = true;
      }
    } else if (nextButtonType === window.NextTypes.NONE) {
      // there's no next button, so it's usually safe to assume there are no
      //   more items exception is when we have, for instance, a dropdown that
      //   gets updated because of other dropdowns when that happens, don't want
      //   to say there are no more items available. current idea for dealing
      //   with this...just don't ask to run the next interaction in the case
      //   where we know there's no next button, so this won't get set, and we
      //   can just come back and ask after doing whatever causes new items, ask
      //   for new items and be pleasantly surprised that some are there
      noMoreItemsAvailable[sid] = true;
    } else {
      window.WALconsole.namedLog("nextInteraction",
        "Failure. Don't know how to produce items because don't know next button type.  Guessing we just want the current page items.");
      noMoreItemsAvailable[sid] = true;
    }
  }

  export function getFreshRelationItems(msg: GenericSelector) {
    getFreshRelationItemsHelper(msg, function(respMsg: FreshRelationItemsMessage) {
      window.WALconsole.log('respMsg', respMsg);
      window.utilities.sendMessage("content", "mainpanel", "freshRelationItems",
        respMsg);
    });
  }

  function extractFromRelationRep(rel: MainpanelNodeRep[][]) {
    return rel.map((row: MainpanelNodeRep[]) =>
      // TODO: cjbaik: is text & frame the correct attributes to use?
      row.map((cell: MainpanelNodeRep) => [cell.text, cell.frame])
    );
  }

  function mainpanelRepresentationOfRelationsEqual(r1: MainpanelNodeRep[][],
    r2: MainpanelNodeRep[][]): boolean {
    let r1Visible = extractFromRelationRep(r1);
    let r2Visible = extractFromRelationRep(r2);
    
    if (r1Visible.length !== r2Visible.length) {
      return false;
    }

    for (let rowIndex = 0; rowIndex < r1Visible.length; rowIndex++) {
      let r1Row = r1Visible[rowIndex];
      let r2Row = r2Visible[rowIndex];
      
      if (r1Row.length !== r2Row.length) {
        return false;
      }
      for (let cellIndex = 0; cellIndex < r1Row.length; cellIndex++) {
        let r1CellAttrs = r1Row[cellIndex];
        let r2CellAttrs = r2Row[cellIndex];
        for (let attrIndex = 0; attrIndex < r1CellAttrs.length; attrIndex++) {
          if (r1CellAttrs[attrIndex] !== r2CellAttrs[attrIndex]) {
            return false;
          }
        }
      }
    }
    return true;
  }

  let relationFinderIdCounter = 0;
  let waitingOnPriorGetFreshRelationItemsHelper = false;
  export function getFreshRelationItemsHelper(selector: GenericSelector,
    continuation: Function, doData = false) {
    if (waitingOnPriorGetFreshRelationItemsHelper && doData === false){
      return;
    }
    let sid = selectorId(selector);
    window.WALconsole.log("noMoreItemsAvailable", noMoreItemsAvailable[sid],
      noMoreItemsAvailable);
  
    if (noMoreItemsAvailable[sid]) {
      // that's it, we're done.  last use of the next interaction revealed there's nothing left
      window.WALconsole.log("no more items at all, because noMoreItemsAvailable was set.");
      continuation({ type: window.RelationItemsOutputs.NOMOREITEMS, relation: null });
    }
    // below is commented out in case there are cases where after first load, it may take a while for the data to all get there (get empty list first, that kind of deal)  Does that happen or is this a wasted opportunity to cache?
    /*
    if (!nextInteractionSinceLastGetFreshRelationItems[strMsg] && (strMsg in currentRelationData)){
      // we have a cached version and the data shouldn't have changed since we cached it
      window.utilities.sendMessage("content", "mainpanel", "freshRelationItems", {type: RelationItemsOutputs.NEWITEMS, relation: currentRelationData[strMsg]});
      return;
    }
    */
    // ok, don't have a cached version, either because never collected before, or bc done a next interaction since then.  better grab the data afresh

    let relationNodes = getRelationMatchingSelector(selector);
    window.WALconsole.log("relationNodes", relationNodes);

    // ok, let's go through these nodes and give them ids if they've never been
    //   scraped for a node before. then we want to figure out whether we're in
    //   a next interaction or a more interaction, so we know how to deal with
    //   info about whether we've scraped already
    let relationNodesIds: number[][] = [];
    for (const row of relationNodes) {
      let rowIds: number[] = [];
      for (const rawCell of row) {
        let cell = <ScrapedElement> rawCell;
        let id;
        if (cell === null || cell === undefined) { 
          // can't save an id on null
          continue;
        } else if (cell.___relationFinderId___ === undefined) {
          // can be 0, so check for undefined rather than truthiness
          // have to add the relationFinderId
          id = relationFinderIdCounter;
          cell.___relationFinderId___ = id;
          relationFinderIdCounter += 1;
        } else {
          // already have relationFinderId saved
          id = cell.___relationFinderId___;
        }
        rowIds.push(id);

        // now, it's nice that we're able to track these rows and all, but if
        //   the page gets updated by javascript or some such thing, we might
        //   keep this id and think we've already scraped something even if we
        //   haven't so use mutationobserver

        // todo: might be better to do this for relationNodes items (row-by-row)
        //   rather than on a cell-by-cell basis. that way if any of the cells
        //   change, we believe the whole row has been updated
        // of course, this still doesn't fix the case where the list has been
        //   ajax-updated, but one of the rows is the same
        // todo: handle that
         
        // create an observer instance
        let observer = new MutationObserver((mutations) => {
          // get rid of the old id, now that it's essentially a different node
          delete cell.___relationFinderId___;
          // stop observing
          observer.disconnect();
        });
    
        // configuration of the observer:
        let config = { attributes: true, childList: true, characterData: true };
        // pass in the target node, as well as the observer options
        try {
          observer.observe(cell, config);
        } catch (err) {
          window.WALconsole.warn("woah, couldn't observe mutations. are we getting all data?");
        }  
      }
      relationNodesIds.push(rowIds);
    }

    if (!(sid in currentRelationSeenNodes)) {
      currentRelationSeenNodes[sid] = [];
    }
    // if there's supposed to be a next button or more button, or scroll for
    //   more, we have to do some special processing
    if (selector.next_type === window.NextTypes.NEXTBUTTON ||
        selector.next_type === window.NextTypes.MOREBUTTON ||
        selector.next_type === window.NextTypes.SCROLLFORMORE) {
      // retrieve the list of ids we've already scraped
      let alreadySeenRelationNodeIds = currentRelationSeenNodes[sid];
      // figure out if the new rows include nodes that were already scraped
      let newRows = [];
      let newRowsIds = [];
      for (let rowIndex = 0; rowIndex < relationNodesIds.length; rowIndex++) {
        let row = relationNodesIds[rowIndex];
        // todo: should we be looking for whether some are new, or all?
        //   requiring all can fail with ajax-updated pages
        // ex: say we're scraping a bunch of papers from a single conference.
        //   conference cell of row will stay the same,
        //   so conference node won't get updated and its id won't get wiped.
        //   in this case, even requiring some to be new could be a problem if
        //   we're only scraping that single column
        // so todo: come up with a better solution
        let someNew = row.some((cell) =>
          !alreadySeenRelationNodeIds.includes(cell));
        if (someNew) {
          newRows.push(relationNodes[rowIndex]);
          newRowsIds.push(row);
        }
      }

      // ok, now that we know which rows are actually new, what do we want to do
      //   with that information?
      if (selector.next_type === window.NextTypes.NEXTBUTTON) {
        // this is a next interaction, so we should never have overlap.
        //   wait until everything is new
        if (relationNodes.length !== newRows.length) {
      	  window.WALconsole.log("sending no new items yet because we found some repeated items and it's a next button.  is that bad?");
          window.WALconsole.log("alreadySeenRelationNodeIds",
            alreadySeenRelationNodeIds.length, alreadySeenRelationNodeIds);
          window.WALconsole.log("relationNodes", relationNodes.length,
            relationNodes);
      	  window.WALconsole.log("newRows", newRows.length, newRows);
          // looks like some of our rows weren't new, so next button hasn't happened yet

          window.WALconsole.log("newRows", newRows);
          continuation({type: window.RelationItemsOutputs.NONEWITEMSYET, relation: null});
        }
        // otherwise we can just carry on, since the relationNodes has the right set
      } else {
        // ok, we're in a more-style interaction, either morebutton or scrollformore
        // the newrows are the new rows, so let's use those!
        relationNodes = newRows;
        relationNodesIds = newRowsIds;
      }
    }

    // ok, we're about to try to figure out if our new data is actual new data
    //   and consider sending it along to mainpanel we know some nodes exist,
    //   but we don't know that they've loaded/finished updating yet to be on
    //   the safe side, let's give them a sec.
    // in fact, ideally we'd like to do better, check if they've stopped
    //   updating; todo: look into this

    if (!doData) {
      // call this function again in a sec, but with doData set to true
      waitingOnPriorGetFreshRelationItemsHelper = true;
      let wait = selector.relation_scrape_wait;
      if (!wait) {
        wait = window.DefaultHelenaValues.relationScrapeWait;
      }
      console.log("wait time", wait);
      setTimeout(function(){
        getFreshRelationItemsHelper(selector, continuation, true);
      }, wait);
    } else {
      // great, we've waited our time and it's time to go
      waitingOnPriorGetFreshRelationItemsHelper = false;
      console.log("relationNodes", relationNodes);
      let relationData = relationNodesToMainpanelNodeRepresentation(
        relationNodes);
      let crd = currentRelationData[sid];
      // we can also have the problem where everything looks new, because everything technically gets updated, 
      // even though some of it is old data, didn't need to be redrawn. so need to do a text check too
      // so that's why we'll compare to the crd, figure out whether the head looks like it's actually old data
      if (crd && crd.length === relationData.length &&
          mainpanelRepresentationOfRelationsEqual(crd, relationData)){
        // data still looks the same as it looked before.  no new items yet.
        window.WALconsole.log("No new items yet because the data is actualy equal");
        window.WALconsole.log(crd, relationData);
        continuation({
          type: window.RelationItemsOutputs.NONEWITEMSYET,
          relation: null
        });
      }

      // whee, we have some new stuff.  we can update the state
      nextInteractionSinceLastGetFreshRelationItems[sid] = false;
      // we only want the fresh ones!
      let newItems = relationData; // start by assuming that's everything
      if (crd) {
        // window.WALconsole.log("crd, relationData, relationData slice", crd,
        //   relationData, relationData.slice(0,crd.length),
        //   _.isEqual(crd, relationData.slice(0, crd.length)))
      }
      if (crd && mainpanelRepresentationOfRelationsEqual(crd,
        relationData.slice(0, crd.length))){
        // cool, this is a case of loading more into the same page, so we want to just grab the end
        newItems = relationData.slice(crd.length, relationData.length);
      }

      // it's important that we don't wipe out the currentRelationdata[strMsg]
      //   unless we actually have new data. if we're doing a more interaction,
      //   might have 0 rows in an intermediate state, but then still need to
      //   trim the top off the list based on having already collected the data
      if (newItems.length > 0) {
        window.WALconsole.namedLog("nextInteraction", "setting relation info",
          selector);
        currentRelationData[sid] = relationData;
        let newRelationSeenNodes = currentRelationSeenNodes[sid].concat(
          (<number[]> []).concat(...relationNodesIds));
        currentRelationSeenNodes[sid] = newRelationSeenNodes.filter(
          (nodeId) => nodeId);
        window.WALconsole.log("actual new items", newItems);
        continuation({
          type: window.RelationItemsOutputs.NEWITEMS,
          relation: newItems
        });
      }
    }

  };
}
