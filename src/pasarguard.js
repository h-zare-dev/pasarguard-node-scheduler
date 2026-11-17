export class PanelError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'PanelError';
    this.statusCode = statusCode;
  }
}

export class PasarGuardClient {
  constructor(config, fetcher = globalThis.fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  async request(method, body) {
    const path = `/api/node/${this.config.target.id}`;
    let response;
    try {
      response = await this.fetcher(`${this.config.panelBaseUrl}${path}`, {
        method,
        headers: {
          'X-Api-Key': this.config.panelApiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new PanelError(`PasarGuard API ${method} unavailable`);
    }
    if (!response.ok) throw new PanelError(`PasarGuard API ${method} returned HTTP ${response.status}`, response.status);
    try {
      return await response.json();
    } catch {
      throw new PanelError(`PasarGuard API ${method} returned invalid JSON`);
    }
  }

  validateNode(node) {
    if (node?.id !== this.config.target.id || node.name !== this.config.target.name ||
        node.core_config_id !== this.config.target.coreConfigId) {
      throw new PanelError('Node identity mismatch; refusing to operate');
    }
    if (typeof node.usage_coefficient !== 'number' || !Number.isFinite(node.usage_coefficient) ||
        node.usage_coefficient < 0 || typeof node.status !== 'string') {
      throw new PanelError('Invalid node status or usage coefficient');
    }
    return {
      id: node.id, name: node.name, status: node.status,
      usage_coefficient: node.usage_coefficient, core_config_id: node.core_config_id,
    };
  }

  async getNode() {
    return this.validateNode(await this.request('GET'));
  }

  async updateCoefficient(value) {
    if (value !== 0 && value !== 1) throw new PanelError('Unsupported coefficient');
    // A fresh read immediately before each write prevents acting on a changed node identity.
    await this.getNode();
    return this.validateNode(await this.request('PUT', { usage_coefficient: value }));
  }

  async updateStatus(status) {
    if (!['disabled', 'connecting'].includes(status)) throw new PanelError('Unsupported node status');
    await this.getNode();
    return this.validateNode(await this.request('PUT', { status }));
  }
}
