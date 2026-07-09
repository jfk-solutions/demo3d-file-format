export class Demo3DError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "Demo3DError";
  }
}

export class Demo3DZipError extends Demo3DError {
  constructor(message: string, code = "DEMO3D_ZIP_ERROR") {
    super(message, code);
    this.name = "Demo3DZipError";
  }
}

export class Demo3DUnsupportedError extends Demo3DError {
  constructor(message: string, code = "DEMO3D_UNSUPPORTED") {
    super(message, code);
    this.name = "Demo3DUnsupportedError";
  }
}

export class Demo3DXmlError extends Demo3DError {
  constructor(message: string, code = "DEMO3D_XML_ERROR") {
    super(message, code);
    this.name = "Demo3DXmlError";
  }
}
