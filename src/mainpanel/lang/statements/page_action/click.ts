import * as Blockly from "blockly";

import { HelenaMainpanel, NodeSources } from "../../../helena_mainpanel";

import { NodeVariable } from "../../../variables/node_variable";
import { PageActionStatement } from "./page_action";
import { ColumnSelector } from "../../../../content/selector/column_selector";
import { GenericRelation } from "../../../relation/generic";
import { PageVariable } from "../../../variables/page_variable";
import { HelenaProgram } from "../../program";
import { Revival } from "../../../revival";
import { TraceType, Trace, DisplayTraceEvent } from "../../../../common/utils/trace";
import { Environment } from "../../../environment";

export class ClickStatement extends PageActionStatement {
  public static maxDim = 50;
  public static maxHeight = 20;

  public columnObj: ColumnSelector.Interface;
  public outputPageVars: PageVariable[];
  public pageUrl: string;
  public pageVar: PageVariable;
  public relation: GenericRelation;

  constructor(trace: TraceType) {
    super();
    Revival.addRevivalLabel(this);
    this.setBlocklyLabel("click");

    this.trace = trace;

    // find the record-time constants that we'll turn into parameters
    const ev = Trace.firstVisibleEvent(trace);
    this.pageVar = Trace.getDOMInputPageVar(ev);
    this.pageUrl = ev.frame.topURL;
    this.node = ev.target.xpath;

    // any event in the segment may have triggered a load
    const domEvents = trace.filter((ev) => ev.type === "dom");

    const outputLoads = domEvents.reduce(
      (acc: TraceType, ev) => {
        const loadEvs = Trace.getDOMOutputLoadEvents(<DisplayTraceEvent> ev);
        if (!loadEvs) {
          throw new ReferenceError("DOM output load events undefined");
        }
        acc.concat(loadEvs);
        return acc;
      }, []);

    this.outputPageVars = outputLoads.map(
      (ev) => Trace.getLoadOutputPageVar(<DisplayTraceEvent> ev));

    // for now, assume the ones we saw at record time are the ones we'll want at
    //   replay
    // this.currentNode = this.node;
    this.origNode = this.node;

    // we may do clicks that should open pages in new tabs but didn't open new
    //   tabs during recording
    // todo: may be worth going back to the ctrl approach, but there are links
    //   that refuse to open that way, so for now let's try back buttons
    // proposeCtrlAdditions(this);
    this.cleanTrace = HelenaMainpanel.cleanTrace(this.trace);

    // actually we want the currentNode to be a nodeVariable so we have a name for the scraped node
    this.currentNode = HelenaMainpanel.makeNodeVariableForTrace(trace);
  }

  public getOutputPagesRepresentation() {
    let prefix = "";
    if (this.hasOutputPageVars()) {
      prefix = this.outputPageVars.map(
        (pv) => pv.toString()
      ).join(", ") + " = ";
    }
    return prefix;
  }

  public prepareToRun() {
    // TODO: cjbaik: is there a case where this is not NodeVariable type?
    if (this.currentNode instanceof NodeVariable) {
      const feats = this.currentNode.getRequiredFeatures();
      this.requireFeatures(feats);
    }
  }

  public toStringLines(): string[] {
    const nodeRep = this.getNodeRepresentation();
    return [
      `${this.getOutputPagesRepresentation()}click(${nodeRep})`
    ];
  }

  public updateBlocklyBlock(program?: HelenaProgram,
      pageVars?: PageVariable[], relations?: GenericRelation[]) {
    if (!program || !pageVars) {
      return;
    }
    // addToolboxLabel(this.blocklyLabel, "web");
    const pageVarsDropDown = HelenaMainpanel.makePageVarsDropdown(pageVars);
    const shapes = ["", "ringer", "output", "ringeroutput"];
    for (const shape of shapes) {
      const shapeLabel = this.blocklyLabel + "_" + shape;
      Blockly.Blocks[shapeLabel] = {
        init: function(this: Blockly.Block) {
          let fieldsSoFar = this.appendDummyInput()
              .appendField("click");

          // let's decide how to display the node
          if (shapeLabel.indexOf("ringer") > -1) {
            // it's just a ringer-identified node, use the pic
            fieldsSoFar = fieldsSoFar.appendField(new Blockly.FieldImage("node",
              ClickStatement.maxDim, ClickStatement.maxHeight, "node image"),
              "node");
          } else {
            // it has a name so just use the name
            fieldsSoFar = fieldsSoFar.appendField(
              new Blockly.FieldTextInput("node"), "node");
          }
          fieldsSoFar = fieldsSoFar.appendField("in")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown), "page");

          // let's decide whether there's an output page
          if (shapeLabel.indexOf("output") > -1) {
            fieldsSoFar = fieldsSoFar.appendField(", load page into")
              .appendField(new Blockly.FieldDropdown(pageVarsDropDown),
              "outputPage");
          }
          this.setPreviousStatement(true, null);
          this.setNextStatement(true, null);
          this.setColour(280);
        },
        onchange: function(ev: Blockly.Events.Abstract) {
          const newName = this.getFieldValue("node");
          const clickStmt = <ClickStatement> HelenaMainpanel.getHelenaStatement(this);
          const currentName = clickStmt.currentNode.getName();
          if (newName !== currentName) {
            // new name so update all our program display stuff
            clickStmt.currentNode.setName(newName);

            // update without updating how blockly appears
            HelenaMainpanel.UIObject.updateDisplayedScript(false);

            // now make sure the relation column gets renamed too
            const colObj = clickStmt.currentColumnObj();
            if (colObj) {
              colObj.name = newName;
              HelenaMainpanel.UIObject.updateDisplayedRelations();
            }
          }
          if (ev instanceof Blockly.Events.Ui) {
            const uiEv = <HelenaBlockUIEvent> ev;
            
            // unselected
            if (uiEv.element === "selected" && uiEv.oldValue === this.id) {
              HelenaMainpanel.UIObject.updateDisplayedScript(true);
            }
          }
        }
      };
    }
  }

  public genBlocklyNode(prevBlock: Blockly.Block,
      workspace: Blockly.WorkspaceSvg) {
    let label = this.blocklyLabel + "_";

    if (this.currentNode.getSource() === NodeSources.RINGER) {
      label += "ringer";
    }
    if (this.outputPageVars && this.outputPageVars.length > 0) {
      label += "output";
    }

    this.block = workspace.newBlock(label);

    if (this.currentNode.getSource() === NodeSources.RINGER) {
      this.block.setFieldValue(this.getNodeRepresentation(), "node");
    } else {
      this.block.setFieldValue(this.getNodeRepresentation(), "node");
    }

    if (this.outputPageVars && this.outputPageVars.length > 0) {
      this.block.setFieldValue(this.outputPageVars[0].toString(), "outputPage");
    }

    this.block.setFieldValue(this.pageVar.toString(), "page");

    HelenaMainpanel.attachToPrevBlock(this.block, prevBlock);
    HelenaMainpanel.setHelenaStatement(this.block, this);
    return this.block;
  }

  public pbvs() {
    const pbvs = [];
    if (this.currentTab()) {
      // do we actually know the target tab already?  if yes, go ahead and
      //   paremterize that
      pbvs.push({
        type: "tab",
        value: this.originalTab()
      });
    }

    // we only want to pbv for things that must already have been extracted by
    //   relation extractor
    if (this.currentNode instanceof NodeVariable &&
        this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR) {
      pbvs.push({
        type: "node",
        value: this.node
      });
    }
    return pbvs;
  }

  public parameterizeForRelation(relation: GenericRelation):
      (ColumnSelector.Interface | null)[] {
    return [
      this.parameterizeNodeWithRelation(relation, this.pageVar)
    ];
  };

  public unParameterizeForRelation(relation: GenericRelation) {
    this.unParameterizeNodeWithRelation(relation);
  }

  public args(environment: Environment.Frame) {
    const args = [];
    args.push({
      type: "tab",
      value: this.currentTab()
    });
    
    // we only want to pbv for things that must already have been extracted by
    //   relation extractor
    if (this.currentNode instanceof NodeVariable && 
        this.currentNode.getSource() === NodeSources.RELATIONEXTRACTOR) {
      args.push({
        type: "node",
        value: this.currentNodeXpath(environment)
      });
    }
    return args;
  }

  public currentRelation() {
    return this.relation;
  }

  public currentColumnObj() {
    return this.columnObj;
  }

  public hasOutputPageVars() {
    return this.outputPageVars && this.outputPageVars.length > 0;
  }
}

/*
function proposeCtrlAdditions(statement) {
  if (statement.outputPageVars.length > 0) {
    var counter = 0;
    var lastIndex = _.reduce(statement.trace, function(acc, ev) {counter += 1; if (Trace.getDOMOutputLoadEvents(ev).length > 0) {return counter;} else {return acc;}}, 0);

    var ctrlKeyDataFeatures = {altKey: false, bubbles: true, cancelable: true, charCode: 0, ctrlKey: true, keyCode: 17, keyIdentifier: "U+00A2", keyLocation: 1, metaKey: false, shiftKey: false, timeStamp: 1466118461375, type: "keydown"};

    var ctrlDown = cleanEvent(statement.trace[0]); // clones
    ctrlDown.data = ctrlKeyDataFeatures;
    ctrlDown.meta.dispatchType = "KeyboardEvent";

    var ctrlUp = cleanEvent(statement.trace[0]);
    ctrlUp.data = clone(ctrlKeyDataFeatures);
    ctrlUp.data.ctrlKey = false;
    ctrlUp.data.type = "keyup";
    ctrlUp.meta.dispatchType = "KeyboardEvent";

    statement.trace.splice(lastIndex, 0, ctrlUp);
    statement.trace.splice(0, 0, ctrlDown);

    WALconsole.log(ctrlUp, ctrlDown);

    for (var i = 0; i < lastIndex + 1; i++) { // lastIndex + 1 because we just added two new events!
      if (statement.trace[i].data) {
        statement.trace[i].data.ctrlKey = true; // of course may already be true, which is fine
      }
    }
  }
}*/