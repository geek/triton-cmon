<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2016, Joyent, Inc.
-->

# Triton Metric Agent

This is the home of the compute node agent portion of the Triton Container
Monitor solution. Triton Metric Agent Proxy acts as if it is many individual
Prometheus monitoring agents by supporting a polling route per container on the
compute node it resides on.

Please see
[RFD 27](https://github.com/joyent/rfd/blob/master/rfd/0027/README.md#) for more
information.

## Development

```
make all
```

## Test

```
make test
```

## Lint

```
make check
```
## Documentation

For an overview of Triton Metric Agent and the Triton Container Monitor solution
, please see
[RFD 27](https://github.com/joyent/rfd/blob/master/rfd/0027/README.md#).

For documentation specific to Metric Agent, please see
[docs/README.md](docs/README.md).

## License

"Triton Metric Agent" is licensed under the
[Mozilla Public License version 2.0](http://mozilla.org/MPL/2.0/).
See the file LICENSE.
