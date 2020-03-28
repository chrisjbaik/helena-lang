import * as stringify from "json-stable-stringify";

import { HelenaConsole } from "./utils/helena_console";

export namespace MiscUtilities {
  let currentResponseRequested: {
    [key: string]: boolean
  } = {};
  let currentResponseHandler: {
    [key: string]: Function
  } = {};

  export function makeNewRecordReplayWindow(cont: Function,
      specifiedUrl?: string, winWidth?: number, winHeight?: number) {
    chrome.windows.getCurrent((curWindow) => {
      const right = <number> curWindow.left + <number> curWindow.width;
      let width = null;
      let height = null;
      chrome.system.display.getInfo(function(displayInfoLs){
        for (var i = 0; i < displayInfoLs.length; i++){
          const bounds = displayInfoLs[i].bounds;
          const rightBound = bounds.left + bounds.width;
          HelenaConsole.log(bounds);
          if (bounds.left <= right && rightBound >= right){
            // we've found the right display
            // - 40 because it doesn't seem to count the menu bar and I'm not
            //   looking for a more accurate solution at the moment
            var top = <number> curWindow.top - 40;
            var left = right; // let's have it adjacent to the control panel
            console.log(rightBound - right, bounds.top + bounds.height - top);
            if (!winWidth || !winHeight){
              width = rightBound - right;
              height = bounds.top + bounds.height - top;
            } else {
              width = winWidth;
              height = winHeight;
            }

            // for now let's actually make width and height fixed for stability
            //   across different ways of running (diff machines, diff panel
            //   sizes at start)
            // 1419 1185
            //var width = 1419;
            //var height = 1185;
            let url = specifiedUrl;
            if (!url) {
              url = "pages/newRecordingWindow.html"
            }
            chrome.windows.create({
              url: url,
              focused: true,
              left: left,
              top: top,
              width: width,
              height: height
            }, (win) => {
              HelenaConsole.log("new record/replay window created.");
            
              // todo: should probably still send this for some cases
              //pub.sendCurrentRecordingWindow();

              if (win) {
                cont(win.id);
              }
            });
          }
        }
      });
    });
  };

  export function levenshteinDistance(a: string, b: string) {
    if (a.length === 0) return b.length; 
    if (b.length === 0) return a.length; 

    const matrix = [];

    // increment along the first column of each row
    for(let i = 0; i <= b.length; i++){
      matrix[i] = [i];
    }

    // increment each column in the first row
    for(let j = 0; j <= a.length; j++){
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for(let i = 1; i <= b.length; i++){
      for(let j = 1; j <= a.length; j++){
        if (b.charAt(i-1) === a.charAt(j-1)) {
          matrix[i][j] = matrix[i-1][j-1];
        } else {
          matrix[i][j] = Math.min(matrix[i-1][j-1] + 1, // substitution
                                  Math.min(matrix[i][j-1] + 1, // insertion
                                           matrix[i-1][j] + 1)); // deletion
        }
      }
    }

    return matrix[b.length][a.length];
  }

  export function depthOf(object: { [key: string]: any }) {
    let level = 1;
    for (const key in object) {
      if (!object.hasOwnProperty(key)) continue;

      if(typeof object[key] === 'object'){
        const depth = depthOf(object[key]) + 1;
        level = Math.max(depth, level);
      }
    }
    return level;
  }

  // note that this does not handle cyclic objects!
  export function removeAttributeRecursive(obj: { [key: string]: any },
    attribute: string) {
    if (typeof obj !== "object" || obj === null){ 
      return; // nothing to do here
    } else {
      // ok, it's an object
      if (attribute in obj) {
        // ok, we actually want to remove
        delete obj[attribute];
      }
      // time to descend
      for (const prop in obj) {
        removeAttributeRecursive(obj[prop], attribute);
      }
    }
  }

  export function repeatUntil(repeatFunction: Function, untilFunction: Function,
    afterFunction: Function, interval: number, grow = false) {
    if (untilFunction()){
      afterFunction();
      return;
    }
    repeatFunction();
    let nextInterval = interval;
    if (grow) {
      // is this really how we want to grow it? should a strategy be passed in?
      nextInterval = nextInterval * 2;
    }
    HelenaConsole.log("grow", grow);
    HelenaConsole.log("interval", nextInterval);
    setTimeout(() => {
      repeatUntil(repeatFunction, untilFunction, afterFunction, nextInterval,
        grow);
    }, interval);
  }

  /**
   * Get the current, most up-to-date response from a message sent from the
   *   mainpanel to content script, to avoid having a backlog of repeated
   *   messages sent.
   * Caveat: If anything changes about the message, this is a bad way to handle
   *   it; e.g. if we have a counter in the message saying how many times it's
   *   been sent.
   * @param message message to send
   * @param handler handler for response
   */
  export function registerCurrentResponseRequested(message: object,
      handler: Function) {
    const key = stringify(message);
    HelenaConsole.namedLog("getRelationItems",
      "registering new handler for key", key.slice(0, 40));
    currentResponseRequested[key] = true;
    currentResponseHandler[key] = (msg: object) => {
      HelenaConsole.namedLog("getRelationItems",
        "running the current handler for key:", key.slice(0, 40));
      handler(msg);
    };

    // Add to end of message queue, such that each message is responded to only
    //   once, and any additional calls are ignored.
    setTimeout(() => {
      const key = stringify(message);
      if (currentResponseRequested[key]) {
        currentResponseRequested[key] = false;
        // now call the actual function
        currentResponseHandler[key](message);
        HelenaConsole.namedLog("getRelationItems",
          "we successfully did handleRegisterCurrentResponseRequested for key",
          key.slice(0, 40));
      } else {
        HelenaConsole.namedLog("getRelationItems",
          "we tried to do handleRegisterCurrentResponseRequested for key",
          key.slice(0, 40),
          "but there was nothing registered.  throwing it out.");
      }
      // handleRegisterCurrentResponseRequested(message);
    }, 0);
  }

  export function truncateDictionaryStrings(dict: { [key: string]: any },
      stringLengthLimit: number, keysToSkip: string[]) {
    for (const key in dict){
      const val = dict[key];
      if (!keysToSkip.includes(key) && typeof val === 'string' &&
           val.length > stringLengthLimit){
        dict[key] = val.slice(0, stringLengthLimit);
      }
    }
  }

  export function dirtyDeepcopy(obj: object) {
    return JSON.parse(JSON.stringify(obj));
  }
}