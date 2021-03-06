import 'mocha';
import { expect } from 'chai';
import { resetState } from '../../lib/utils';
import Pulse from '../../lib';

describe('resetState function', () => {
    const App = new Pulse({ noCore: true })

    const state = App.State('initial value')
    
    it('updates State properly', () => {
        state.set('changed value')
        expect(state.value).to.eq('changed value')
    })

    it('resets State to proper initial value', () => {
        resetState([state])
        expect(state.value).to.eq('initial value')
    })
})
