"use strict";
if (typeof Web3 === 'undefined' && typeof require === 'function' ) {
  var Web3 = require("web3");
}

if (typeof localStorage === 'undefined' && typeof require === 'function' ) {
  const LocalStorage = require('node-localstorage').LocalStorage;
  var localStorage = new LocalStorage('./local_storage');
}


class RaidenMicropaymentsClient {

  constructor(
    web3url,
    contractAddr,
    contractABI,
    tokenAddr,
    tokenABI,
  ) {
    if (!web3url) {
      web3url = "http://localhost:8545";
    }
    if (web3url.currentProvider) {
      this.web3 = new Web3(web3.currentProvider);
    }
    else if (typeof web3url === 'string') {
      this.web3 = new Web3(new Web3.providers.HttpProvider(web3url));
    }

    contractAddr = contractAddr || window["RDNcontractAddr"];
    contractABI = contractABI || window["RDNcontractABI"];
    this.contract = this.web3.eth.contract(contractABI).at(contractAddr);

    tokenAddr = tokenAddr || window["RDNtokenAddr"];
    tokenABI = tokenABI || window["RDNtokenABI"];
    this.token = this.web3.eth.contract(tokenABI).at(tokenAddr);
  }

  loadStoredChannel(account, receiver) {
    if (!localStorage) {
      this.channel = undefined;
      return;
    }
    const key = account + "|" + receiver;
    const value = localStorage.getItem(key);
    if (value) {
      this.channel = JSON.parse(value);
    } else {
      this.channel = undefined;
    }
  }

  forgetStoredChannel() {
    if (localStorage) {
      const key = this.channel.account + "|" + this.channel.receiver;
      localStorage.removeItem(key);
    }
    this.channel = undefined;
  }

  setChannelInfo(channel) {
    this.channel = channel;
    if (localStorage) {
      const key = channel.account + "|" + channel.receiver;
      localStorage.setItem(key, JSON.stringify(this.channel));
    }
  }

  getAccounts(callback) {
    return this.web3.eth.getAccounts(callback);
  }

  signHash(msg, account, callback) {
    try {
      console.log("Signing", msg, account);
      return this.web3.eth
        .sign(account, msg, callback);
    } catch (e) {
      return callback(e);
    }
  }

  encodeHex(str) {
    return '0x' + [...str].map((char) => char.charCodeAt(0).toString(16)).join('');
  }

  isChannelValid() {
    if (!this.channel || !this.channel.receiver || !this.channel.block
      || isNaN(this.channel.balance) || !this.channel.account) {
      return false;
    }
    return true;
  }

  isChannelOpen(callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }
    this.contract.ChannelCloseRequested({
      _sender: this.channel.account,
      _receiver: this.channel.receiver,
      _open_block_number: this.channel.block,
    }, {
      fromBlock: this.channel.block,
      toBlock: 'latest'
    }).get((err, closeEvents) => {
      if (err) {
        return callback(err);
      } else if (!closeEvents || closeEvents.length === 0) {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    });
  }

  openChannel_ERC20(account, receiver, deposit, callback) {
    if (this.isChannelValid()) {
      console.warn("Already valid channel will be forgotten:", this.channel);
    }
    // send 'approve' transaction
    this.token.approve.sendTransaction(
      this.contract.address,
      deposit,
      { from: account },
      (err, approveTxHash) => {
        if (err) {
          return callback(err);
        }
        // send 'createChannel' transaction
        return this.contract.createChannel.sendTransaction(
          receiver,
          deposit,
          { from: account },
          (err, createChannelTxHash) => {
            if (err) {
              return callback(err);
            }
            // wait for 'createChannel' transaction to be mined
            this.waitTx(createChannelTxHash, (err, receipt) => {
              if (err) {
                return callback(err);
              }
              // call getChannelInfo to be sure channel was created
              return this.contract.getChannelInfo.call(
                account,
                receiver,
                receipt.blockNumber,
                { from: account },
                (err, info) => {
                  if (err || !(info[1] > 0)) {
                    return callback(err || info);
                  }
                  this.setChannelInfo({account, receiver, block: receipt.blockNumber, balance: 0});
                  // return channel
                  return callback(null, this.channel);
                });
              });
          });
      });
  }

  openChannel(account, receiver, deposit, callback) {
    if (this.isChannelValid()) {
      console.warn("Already valid channel will be forgotten:", this.channel);
    }

    // send 'transfer' transaction
    this.token.transfer["address,uint256,bytes"].sendTransaction(
      this.contract.address,
      deposit,
      this.encodeHex(receiver), // receiver goes as 3rd param, hex encoded
      { from: account },
      (err, transferTxHash) => {
        if (err) {
          return callback(err);
        }
        console.log('transferTxHash', transferTxHash);
        // wait for 'transfer' transaction to be mined
        return this.waitTx(transferTxHash, (err, receipt) => {
          if (err) {
            return callback(err);
          }
          // call getChannelInfo to be sure channel was created
          return this.contract.getChannelInfo.call(
            account,
            receiver,
            receipt.blockNumber,
            { from: account },
            (err, info) => {
              if (err || !(info[1] > 0)) {
                return callback(err || info);
              }
              this.setChannelInfo({account, receiver, block: receipt.blockNumber, balance: 0});
              // return channel
              return callback(null, this.channel);
            });
          });
      });
  }

  topUpChannel_ERC20(deposit, callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }
    // send 'approve' transaction
    this.token.approve.sendTransaction(
      this.contract.address,
      deposit,
      { from: account },
      (err, approveTxHash) => {
        if (err) {
          return callback(err);
        }
        // send 'createChannel' transaction
        return this.contract.topUp.sendTransaction(
          this.channel.receiver,
          this.channel.block,
          deposit,
          { from: account },
          (err, topUpTxHash) => {
            if (err) {
              return callback(err);
            }
            // wait for 'topUp' transaction to be mined
            this.waitTx(topUpTxHash, (err, receipt) => {
              if (err) {
                return callback(err);
              }
              // return block number
              return callback(null, receipt.blockNumber);
            });
          });
      });
  }

  topUpChannel(deposit, callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }

    // send 'transfer' transaction
    this.token.transfer["address,uint256,bytes"].sendTransaction(
      this.contract.address,
      deposit,
      // TODO: where goes openBlockNumber for ERC223 topUp?
      this.encodeHex(this.channel.receiver), // receiver goes as 3rd param, hex encoded
      { from: this.channel.account },
      (err, transferTxHash) => {
        if (err) {
          return callback(err);
        }
        console.log('transferTxHash', transferTxHash);
        // wait for 'transfer' transaction to be mined
        return this.waitTx(transferTxHash, (err, receipt) => {
          if (err) {
            return callback(err);
          }
          // call getChannelInfo to be sure channel was created
          return this.contract.getChannelInfo.call(
            this.channel.account,
            this.channel.receiver,
            this.channel.block,
            { from: this.channel.account },
            (err, info) => {
              if (err || !(info[1] > 0)) {
                return callback(err || info);
              }
              // return block number
              return callback(null, receipt.blockNumber);
            });
        });
      });
  }

  closeChannel(receiverSig, callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }
    return this.isChannelOpen((err, isOpen) => {
      if (err) {
        return callback(err);
      } else if (!isOpen) {
        return callback(new Error("Tried closing already closed channel"));
      }
      let func;
      if (!this.channel.sign) {
        func = (cb) => this.signBalance(this.channel.balance, cb);
      } else {
        func = (cb) => cb(null, this.channel.sign);
      }
      return func((err, sign) => {
        if (err) {
          return callback(err);
        }
        let params = [
          this.channel.receiver,
          this.channel.block,
          this.channel.balance,
          sign
        ];
        let paramsTypes = "address,uint32,uint192,bytes";
        if (receiverSig) {
          params.push(receiverSig);
          paramsTypes += ",bytes";
        }
        return this.contract.close[paramsTypes].sendTransaction(
          ...params,
          { from: this.channel.account },
          (err, txHash) => {
            if (err) {
              return callback(err);
            }
            return this.waitTx(txHash, (err, receipt) => {
              if (err) {
                return callback(err);
              }
              return callback(null, receipt.blockNumber);
            });
          });
      });
    });
  }

  settleChannel(callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }
    return this.isChannelOpen((err, isOpen) => {
      if (err) {
        return callback(err);
      } else if (isOpen) {
        return callback(new Error("Tried settling open channel"));
      }
      return this.contract.settle.sendTransaction(
        this.channel.receiver,
        this.channel.block,
        { from: this.channel.account },
        (err, txHash) => {
          if (err) {
            return callback(err);
          }
          return this.waitTx(txHash, (err, receipt) => {
            if (err) {
              return callback(err);
            }
            return callback(null, receipt.blockNumber);
          });
        }
      );
    });
  }

  signBalance(newBalance, callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }
    console.log("signBalance", newBalance, this.channel);
    if (newBalance === null) {
      newBalance = this.channel.balance;
    }
    if (newBalance === this.channel.balance && this.channel.sign) {
      return callback(null, this.channel.sign);
    }
    return this.contract.balanceMessageHash.call(
      this.channel.receiver,
      this.channel.block,
      newBalance,
      { from: this.channel.account },
      (err, msgHash) => {
        if (err) {
          return callback(err);
        }
        // ask for signing of this message
        this.signHash(msgHash, this.channel.account, (err, sign) => {
          if (err) {
            return callback(err);
          }
          // return signed message
          if (newBalance === this.channel.balance && !this.channel.sign) {
            this.channel.sign = sign;
          }
          return callback(null, sign);
        });
      });
  }

  incrementBalanceAndSign(amount, callback) {
    if (!this.isChannelValid()) {
      return callback(new Error("No valid channelInfo"));
    }
    const newBalance = this.channel.balance + +amount;
    // get current deposit
    this.contract.getChannelInfo.call(
      this.channel.account,
      this.channel.receiver,
      this.channel.block,
      { from: this.channel.account },
      (err, info) => {
        if (err) {
          return callback(err);
        }
        console.log("Channel info:", info);
        const deposit = info[1];
        if (newBalance > deposit) {
          return callback(new Error("Insuficient funds: current = "+deposit+
            ", required = +"+newBalance-deposit));
        }
        return this.isChannelOpen((err, isOpen) => {
          if (err) {
            return callback(err);
          } else if (!isOpen) {
            return callback(new Error("Tried signing on closed channel"));
          }
          // get hash for new balance proof
          return this.signBalance(newBalance, (err, sign) => {
            if (err) {
              return callback(err);
            }
            this.setChannelInfo(Object.assign(
              {},
              this.channel,
              { balance: newBalance, sign }
            ));
            return callback(null, sign);
          });
        });
      });
  }

  waitTx(txHash, callback) {
    /*
     * Watch for a particular transaction hash and call the awaiting function when done;
     * Got it from: https://github.com/ethereum/web3.js/issues/393
     */
    let blockCounter = 15;
    // Wait for tx to be finished
    let filter = this.web3.eth.filter('latest').watch((err, blockHash) => {
      if (blockCounter<=0) {
        filter.stopWatching();
        filter = null;
        console.warn('!! Tx expired !!');
        return callback(new Error("Tx expired"));
      }
      // Get info about latest Ethereum block
      return this.web3.eth.getTransactionReceipt(txHash, (err, receipt) => {
        --blockCounter;
        if (err) {
          return callback(err);
        } else if (!receipt || !receipt.blockNumber) {
          return console.log('Waiting tx..', blockCounter);
        }
        // Tx is finished
        filter.stopWatching();
        filter = null;
        return callback(null, receipt);
      });
    });
  }

}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports.RaidenMicropaymentsClient = RaidenMicropaymentsClient;
} else if (typeof define === 'function' && define.amd) {
  define([], function() {
    return RaidenMicropaymentsClient;
  });
} else {
  window.RaidenMicropaymentsClient = RaidenMicropaymentsClient;
}
