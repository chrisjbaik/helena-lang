import { ColumnSelector } from "../../content/selector/column_selector";
import { MainpanelNode } from "../../common/mainpanel_node";
import { NodeVariable } from "../variables/node_variable";
import { HelenaMainpanel } from "../helena_mainpanel";
import { HelenaLangObject } from "../lang/helena_lang";
import { PageVariable } from "../variables/page_variable";
import { RunObject } from "../lang/program";

export class GenericRelation {
  public name: string;
  public columns: ColumnSelector.Interface[];
  public firstRowTexts: string[];
  public nodeVars: NodeVariable[];

  public clearRunningState() {
    return;
  }

  public columnName(colObj: (ColumnSelector.Interface | null) []) {
    return colObj.map((colObj) => {
      if (colObj && colObj.name) {
        return colObj.name;
      } else {
        return "undefined";
      }
    });
  }

  public columnNames() {
    return this.columns.map((colObj) => colObj.name? colObj.name : "undefined");
  }

  public demonstrationTimeRelationText(): string[][] {
    return [];
  }

  public firstRowNodeRepresentation(colObj: ColumnSelector.Interface) {
    if (!colObj.index) {
      throw new ReferenceError("ColumnSelector has no index.");
    }
    const firstRow = this.firstRowNodeRepresentations();
    return firstRow[colObj.index];
  }

  public firstRowNodeRepresentations(): MainpanelNode.Interface[] {
    return [];
  }

  public getColumnObjectFromXpath(xpath: string) {
    for (const column of this.columns) {
      if (column.xpath === xpath) {
        return column;
      }
    }
    window.WALconsole.log("Ack!  No column object for that xpath: ",
      this.columns, xpath);
    return null;
  }

  public getNextRow(runObject: RunObject, pageVar: PageVariable,
    callback: Function) {
      return;
  }

  public nodeVariables(): NodeVariable[] {
    return [];
  }

  public processColumns() {
    return;
  }

  public scrapedColumnNames() {
    return this.columns.filter((colObj) => colObj.scraped)
                       .map((colObj) => colObj.name? colObj.name : "undefined");
  }

  public setColumnName(columnObj: ColumnSelector.Interface, v: string) {
    columnObj.name = v;

    if (!columnObj.index) {
      throw new ReferenceError("Column selector index not provided.");
    }
    
    const nodeVariables = this.nodeVariables();
    nodeVariables[columnObj.index].setName(v);
    HelenaMainpanel.UIObject.updateDisplayedScript();
  }

  public updateNodeVariables(environment: EnvironmentPlaceholder,
    pageVar: PageVariable) {
      return;
  }

  public usedByStatement(statement: HelenaLangObject): boolean {
    return false;
  }
}