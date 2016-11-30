# cmon and cmon-agent

Install:

```
[root@headnode (coal) ~]# curl https://gist.github.com/richardkiene/724a343804c17444444412ff791912a5 > install_cmon.sh
[root@headnode (coal) ~]# chmod +x install_cmon.sh
[root@headnode (coal) ~]# ./install_cmon.sh
Using channel experimental
Update to sdcadm 1.12.0 (CMON-8-20161117T045143Z-gba152e9)
Download update from https://updates.joyent.com
Run sdcadm installer (log at /var/sdcadm/self-updates/20161130T230339Z/install.log)
Updated to sdcadm 1.12.0 (CMON-8-20161117T045143Z-gba152e9, elapsed 7s)
Downloading image 1986611a-b1d2-11e6-8191-63df1548239f
    (cmon@CMON-8-20161123T230630Z-g124069f)
Imported image 1986611a-b1d2-11e6-8191-63df1548239f
    (cmon@CMON-8-20161123T230630Z-g124069f)
Creating "cmon" service
Creating "cmon" instance
Created VM bdbf71c7-ef60-409a-b338-575b6bf93f7e (cmon0)
Setup "cmon" (58s)
Finding candidate update images for the "cmon" service.
Using channel experimental
Up-to-date.
Checking for minimum SAPI version
Checking if service 'vm-agent' exists
Checking if service 'net-agent' exists
Checking if service 'cn-agent' exists
Checking if service 'agents_core' exists
Checking if service 'cmon-agent' exists
Checking if service 'amon-agent' exists
Checking if service 'amon-relay' exists
Checking if service 'cabase' exists
Checking if service 'cainstsvc' exists
Checking if service 'config-agent' exists
Checking if service 'firewaller' exists
Checking if service 'hagfish-watcher' exists
Checking if service 'smartlogin' exists
Adding service for agent 'cmon-agent'
Add new agent services finished (elapsed 0s).
Found agentsshar 671b7f40-b479-4cbf-b758-7b96299fa098 (1.0.0-CMON-8-20161118T014828Z-g5c4baca)
Finding servers to update

This update will make the following changes:
    Download agentsshar 671b7f40-b479-4cbf-b758-7b96299fa098
        (1.0.0-CMON-8-20161118T014828Z-g5c4baca)
    Update GZ agents on 4 (of 4) servers using
        agentsshar 1.0.0-CMON-8-20161118T014828Z-g5c4baca

Downloading agentsshar from updates server (channel "experimental")
    to /var/tmp/agent-671b7f40-b479-4cbf-b758-7b96299fa098.sh
Copy agentsshar to assets dir: /usbkey/extra/agents
Create /usbkey/extra/agents/latest symlink
Starting agentsshar update on 4 servers
Updating node.config                                        [==============================================================================================================================================>] 100%        4
Downloading agentsshar                                      [==============================================================================================================================================>] 100%        4
Installing agentsshar                                       [==============================================================================================================================================>] 100%        4
Deleting temporary /var/tmp/agent-671b7f40-b479-4cbf-b758-7b96299fa098.sh
Reloading sysinfo on updated servers
Sysinfo reloaded for all the running servers
Refreshing config-agent on all the updated servers
Config-agent refreshed on updated servers
Successfully updated agents (2m51s)
```

Now you can watch the agent:

```
[root@headnode (coal) ~]# tail -f `svcs -L cmon-agent` | bunyan --color
[2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: listening (url=http://10.99.99.7:9163)
[2016-11-18T02:16:18.674Z]  INFO: cmon-agent/84455 on headnode: startup complete
...
```
# prometheus server

Create an Ubuntu 14.04 LX zone for Prometheus with Admin and External NICs (via AdminUI or triton-cli)
```
Image UUID: 7b27a514-89d7-11e6-bee6-3f96f367bee7
Package: sample-1G 1.0.0
```

Install necessary applications in your Ubuntu 14.04 LX zone:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# apt-get update && apt-get dist-upgrade
root@e3902c56-cea8-691b-fa78-963e2447682a:~# apt-get install git
root@e3902c56-cea8-691b-fa78-963e2447682a:~# apt-get install build-essential
root@e3902c56-cea8-691b-fa78-963e2447682a:~# sudo apt-get install dnsutils
```

Install [Go](https://golang.org/doc/install) on the newly created Ubuntu 14.04 LX zone
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# wget https://storage.googleapis.com/golang/go1.7.3.linux-amd64.tar.gz
--2016-11-18 02:45:50--  https://storage.googleapis.com/golang/go1.7.3.linux-amd64.tar.gz
Resolving storage.googleapis.com (storage.googleapis.com)... 2607:f8b0:400a:809::2010, 172.217.3.208
Connecting to storage.googleapis.com (storage.googleapis.com)|2607:f8b0:400a:809::2010|:443... failed: Network is unreachable.
Connecting to storage.googleapis.com (storage.googleapis.com)|172.217.3.208|:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: 82565628 (79M) [application/x-gzip]
Saving to: ‘go1.7.3.linux-amd64.tar.gz’

100%[====================================================================================================================================================================================================================================================================================>] 82,565,628  5.51MB/s   in 17s

2016-11-18 02:46:07 (4.75 MB/s) - ‘go1.7.3.linux-amd64.tar.gz’ saved [82565628/82565628]

root@e3902c56-cea8-691b-fa78-963e2447682a:~# tar -C /usr/local -xzf go1.7.3.linux-amd64.tar.gz
root@e3902c56-cea8-691b-fa78-963e2447682a:~# export GOPATH=$HOME/work
```


Configure DNS in the LX zone to point at CNS:
```
## Add CNS Admin IP to resolv.conf
## nameserver 10.99.99.40
root@e3902c56-cea8-691b-fa78-963e2447682a:~# vim /etc/resolvconf/resolv.conf.d/base
root@e3902c56-cea8-691b-fa78-963e2447682a:~# resolvconf -u
```

Generate key and cert from your CoaL user private key:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~/.ssh# openssl rsa -in \
your_private_rsa -outform
pem >promkey.pem
writing RSA key
root@e3902c56-cea8-691b-fa78-963e2447682a:~/.ssh# openssl req -new -key \
promkey.pem -out promcsr.pem -subj "/CN=YOUR_ACCOUNT_NAME"
root@e3902c56-cea8-691b-fa78-963e2447682a:~/.ssh# openssl x509 -req -days 365 \
-in promcsr.pem -signkey promkey.pem -out promcert.pem
Signature ok
subject=/CN=richard
Getting Private key
```

Test from the LX zone that the CMON endpoint us up and running:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# curl --insecure --cert-type pem \
--cert your_cert.pem --key your_key.pem \
"https://cmon.coal.cns.joyent.us:9163/v1/discover"
```

Install Prometheus from the joyent/prometheus fork on the CMON-8 branch:
```
root@e3902c56-cea8-691b-fa78-963e2447682a:~# mkdir -p $GOPATH/src/github.com/prometheus
root@e3902c56-cea8-691b-fa78-963e2447682a:~# cd $GOPATH/src/github.com/prometheus
root@e3902c56-cea8-691b-fa78-963e2447682a:~# git clone https://github.com/joyent/prometheus.git
root@e3902c56-cea8-691b-fa78-963e2447682a:~# cd prometheus
root@e3902c56-cea8-691b-fa78-963e2447682a:~# git checkout CMON-8
root@e3902c56-cea8-691b-fa78-963e2447682a:~# make build
```

Create a configuration file for your prometheus instance:
```
global:
  scrape_interval:     10s
  evaluation_interval: 8s
  # scrape_timeout is set to the global default 10s

scrape_configs:
- job_name: triton-coal
  scheme: https
  tls_config:
    cert_file: your_cert.pem
    key_file: your_key.pem
    insecure_skip_verify: true
  triton_sd_configs:
    - account: 'your_username'
      cert: 'your_cert.pem'
      dns_suffix: 'cmon.coal.cns.joyent.us'
      endpoint: 'cmon.coal.cns.joyent.us'
      insecure_skip_verify: true
      key: 'your_key.pem'
      version: 1
```

Start up prometheus:
```
$ ./prometheus -config.file=your_config.yml
```
